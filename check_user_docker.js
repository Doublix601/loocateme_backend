import mongoose from 'mongoose';
import { User } from './src/models/User.js';
import 'dotenv/config';

async function check() {
  const uri = process.env.MONGODB_URI || 'mongodb://appuser:change-me-app@mongo:27017/loocateme';
  await mongoose.connect(uri);
  const user = await User.findOne({ 
    $or: [
      { email: { $regex: /arnaud\.theret/i } }, 
      { username: { $regex: /arnaud\.theret/i } }
    ] 
  });
  if (user) {
    console.log(JSON.stringify({
      username: user.username,
      email: user.email,
      role: user.role
    }, null, 2));
  } else {
    console.log('User not found');
  }
  await mongoose.disconnect();
}
check();
