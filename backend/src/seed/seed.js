import 'dotenv/config';
import { connectDB, disconnectDB } from '../config/db.js';
import { loadData } from './loadData.js';

async function main() {
  const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/vtop_system';
  await connectDB(uri);
  console.log('[seed] wiping collections...');
  await loadData({ log: (m) => console.log(`[seed] ${m}`) });
  console.log('[seed] done.');
  await disconnectDB();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
