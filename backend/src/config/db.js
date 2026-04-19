import mongoose from 'mongoose';

export async function connectDB(uri) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { autoIndex: true });
  console.log('[db] connected:', mongoose.connection.host);
}

export async function disconnectDB() {
  await mongoose.disconnect();
}
