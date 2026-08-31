import 'dotenv/config';
import { cleanupExpiredReceipts } from '../jobs/receiptCleanup';
import { shutdownDatabase } from '../database';

function options(arguments_: string[]) {
  const dryRun = arguments_.includes('--dry-run');
  const limitArgument = arguments_.find((argument) => argument.startsWith('--limit='));
  const limit = limitArgument ? Number(limitArgument.slice('--limit='.length)) : 100;
  return { dryRun, limit };
}

if (require.main === module) {
  void cleanupExpiredReceipts(options(process.argv.slice(2)))
    .then((result) => {
      console.log(JSON.stringify(result));
      if (result.failed > 0) process.exitCode = 1;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(shutdownDatabase);
}
