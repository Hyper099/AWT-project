import 'dotenv/config';
import { connectDB } from './config/db.js';
import { createApp } from './app.js';

const port = process.env.PORT || 5050;
const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/vtop_system';

connectDB(uri)
  .then(() => createApp().listen(port, () => console.log(`[api] listening on :${port}`)))
  .catch((err) => {
    console.error('failed to start', err);
    process.exit(1);
  });
