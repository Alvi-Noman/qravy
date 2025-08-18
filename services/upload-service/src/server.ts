/**
 * @file Server bootstrap
 */
import 'dotenv/config';
import app from './app.js';

function main(): void {
  const port = Number(process.env.PORT || 4010);
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`upload-service listening on :${port}`);
  });
}

main();