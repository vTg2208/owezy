import 'dotenv/config';
import { reconcileReceipts } from '../jobs/receiptReconcile';
import { shutdownDatabase } from '../database';

function value(arguments_: string[], name: string) {
  const argument = arguments_.find((item) => item.startsWith(`${name}=`));
  return argument?.slice(name.length + 1);
}

if (require.main === module) {
  const arguments_ = process.argv.slice(2);
  void reconcileReceipts({
    limit: Number(value(arguments_, '--limit') ?? 100),
    metadataAfter: value(arguments_, '--metadata-after'),
    objectCursor: value(arguments_, '--object-cursor'),
  }).then((result) => {
    console.log(JSON.stringify(result));
    if (result.missing.length || result.orphaned.length) process.exitCode = 2;
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }).finally(shutdownDatabase);
}
