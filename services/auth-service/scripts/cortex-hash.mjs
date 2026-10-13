// Make the Cortex admin's password hash (for CORTEX_ADMIN_PASSWORD_HASH in the auth-service environment).
// Usage:   node services/auth-service/scripts/cortex-hash.mjs          (asks for the password, not echoed to history)
//    or:   CORTEX_PASSWORD='…' node services/auth-service/scripts/cortex-hash.mjs
// Same format as src/utils/cortexAuth.ts (scrypt, N=16384, r=8, p=1, 64-byte key).
import crypto from 'crypto';
import readline from 'readline';

function hash(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt:16384:8:1:${salt.toString('base64')}:${key.toString('base64')}`;
}

const fromEnv = process.env.CORTEX_PASSWORD;
if (fromEnv) {
  console.log(hash(fromEnv));
} else {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl.question('Cortex password: ', (pw) => {
    rl.close();
    if (!pw) process.exit(1);
    console.log(hash(pw));
  });
}
