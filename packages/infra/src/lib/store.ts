import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import type { Category, CategoryRule, Receipt } from '@bill/shared';

/**
 * DynamoDB access, in one place.
 *
 * Single table, keyed `USER#<sub>` / `<TYPE>#<id>`. Receipts sort by date first, so
 * a summary for a period is one Query with BETWEEN on the sort key - no scan, no
 * secondary index, and no date filtering in application code.
 */

const TABLE = process.env.TABLE_NAME!;

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const userKey = (userId: string) => `USER#${userId}`;
const receiptSk = (purchasedAt: string, id: string) => `RECEIPT#${purchasedAt}#${id}`;
const categorySk = (id: string) => `CATEGORY#${id}`;
const ruleSk = (matchKey: string) => `RULE#${matchKey}`;

interface Row<T> {
  pk: string;
  sk: string;
  entity: T;
}

/* -------------------------------------------------------------- categories */

export async function listCategories(userId: string): Promise<Category[]> {
  const result = await client.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: { ':pk': userKey(userId), ':prefix': 'CATEGORY#' },
    }),
  );
  return ((result.Items ?? []) as Row<Category>[])
    .map((row) => row.entity)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function putCategory(userId: string, category: Category): Promise<Category> {
  await client.send(
    new PutCommand({
      TableName: TABLE,
      Item: { pk: userKey(userId), sk: categorySk(category.id), entity: category },
    }),
  );
  return category;
}

export async function getCategory(userId: string, id: string): Promise<Category | null> {
  const result = await client.send(
    new GetCommand({ TableName: TABLE, Key: { pk: userKey(userId), sk: categorySk(id) } }),
  );
  return (result.Item as Row<Category> | undefined)?.entity ?? null;
}

export async function deleteCategory(userId: string, id: string): Promise<void> {
  await client.send(
    new DeleteCommand({ TableName: TABLE, Key: { pk: userKey(userId), sk: categorySk(id) } }),
  );
}

/** Write several categories at once, so a reorder cannot half-apply. */
export async function putCategories(userId: string, categories: Category[]): Promise<void> {
  // TransactWrite caps at 100 items; more categories than that is not a real case,
  // but chunking keeps it from failing silently if it ever happens.
  for (let index = 0; index < categories.length; index += 100) {
    const chunk = categories.slice(index, index + 100);
    await client.send(
      new TransactWriteCommand({
        TransactItems: chunk.map((category) => ({
          Put: {
            TableName: TABLE,
            Item: { pk: userKey(userId), sk: categorySk(category.id), entity: category },
          },
        })),
      }),
    );
  }
}

/* ---------------------------------------------------------------- receipts */

export async function listReceipts(
  userId: string,
  range?: { from: string; to: string },
): Promise<Receipt[]> {
  const result = await client.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: range
        ? 'pk = :pk AND sk BETWEEN :from AND :to'
        : 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: range
        ? {
            ':pk': userKey(userId),
            ':from': `RECEIPT#${range.from}`,
            // "￿" sorts above any id, making the upper bound inclusive of the
            // whole of the end date rather than stopping at its first receipt.
            ':to': `RECEIPT#${range.to}￿`,
          }
        : { ':pk': userKey(userId), ':prefix': 'RECEIPT#' },
      ScanIndexForward: false,
    }),
  );
  return ((result.Items ?? []) as Row<Receipt>[]).map((row) => row.entity);
}

export async function getReceipt(userId: string, id: string): Promise<Receipt | null> {
  // The sort key embeds the purchase date, which a caller holding only an id does
  // not know, so this finds the row by id within the user's own partition.
  const result = await client.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      FilterExpression: 'entity.id = :id',
      ExpressionAttributeValues: { ':pk': userKey(userId), ':prefix': 'RECEIPT#', ':id': id },
    }),
  );
  return ((result.Items ?? []) as Row<Receipt>[])[0]?.entity ?? null;
}

export async function putReceipt(userId: string, receipt: Receipt): Promise<Receipt> {
  await client.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        pk: userKey(userId),
        sk: receiptSk(receipt.purchasedAt, receipt.id),
        entity: receipt,
      },
    }),
  );
  return receipt;
}

export async function deleteReceipt(userId: string, receipt: Receipt): Promise<void> {
  await client.send(
    new DeleteCommand({
      TableName: TABLE,
      Key: { pk: userKey(userId), sk: receiptSk(receipt.purchasedAt, receipt.id) },
    }),
  );
}

/**
 * Editing a receipt's date moves its sort key, so the old row has to go. Doing both
 * in one transaction avoids a window where the receipt exists twice or not at all.
 */
export async function moveReceipt(
  userId: string,
  previousPurchasedAt: string,
  receipt: Receipt,
): Promise<Receipt> {
  if (previousPurchasedAt === receipt.purchasedAt) return putReceipt(userId, receipt);

  await client.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Delete: {
            TableName: TABLE,
            Key: { pk: userKey(userId), sk: receiptSk(previousPurchasedAt, receipt.id) },
          },
        },
        {
          Put: {
            TableName: TABLE,
            Item: {
              pk: userKey(userId),
              sk: receiptSk(receipt.purchasedAt, receipt.id),
              entity: receipt,
            },
          },
        },
      ],
    }),
  );
  return receipt;
}

/* ------------------------------------------------------------------- rules */

export async function listRules(userId: string): Promise<CategoryRule[]> {
  const result = await client.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
      ExpressionAttributeValues: { ':pk': userKey(userId), ':prefix': 'RULE#' },
    }),
  );
  return ((result.Items ?? []) as Row<CategoryRule>[]).map((row) => row.entity);
}

export async function putRule(userId: string, rule: CategoryRule): Promise<CategoryRule> {
  await client.send(
    new PutCommand({
      TableName: TABLE,
      Item: { pk: userKey(userId), sk: ruleSk(rule.matchKey), entity: rule },
    }),
  );
  return rule;
}

export async function deleteRuleByMatchKey(userId: string, matchKey: string): Promise<void> {
  await client.send(
    new DeleteCommand({ TableName: TABLE, Key: { pk: userKey(userId), sk: ruleSk(matchKey) } }),
  );
}
