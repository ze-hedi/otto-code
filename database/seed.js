const { connect, disconnect } = require('./connection');
const Agent = require('./models/Agent');

async function seed() {
  await connect();

  await Agent.deleteMany({});
  console.log('All agents deleted.');

  await disconnect();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
