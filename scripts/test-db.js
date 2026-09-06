require('dotenv').config();
const { Client } = require('pg');

// Use localhost if running on host (test script only)
// Also strip sslmode=prefer because localhost postgres usually doesn't have SSL configured
const dbUrl = process.env.DATABASE_URL || '';
const isHost = dbUrl.includes('opsknight-db');
const connectionString = isHost
    ? dbUrl.replace('opsknight-db', 'localhost').replace('sslmode=prefer', 'sslmode=disable')
    : dbUrl;

const config = {
    connectionString,
    connectionTimeoutMillis: 5000,
};

console.log('🔍 Testing Database Connection...');
console.log(`📡 URL: ${connectionString.replace(/:[^:]+@/, ':****@')}`); // Mask password

const client = new Client(config);

async function testConnection() {
    try {
        await client.connect();
        console.log('✅ Connected successfully to Postgres!');

        const res = await client.query('SELECT NOW(), current_database()');
        console.log(`🕒 Database Time: ${res.rows[0].now}`);
        console.log(`💽 Database Name: ${res.rows[0].current_database}`);

        const tableRes = await client.query("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'");
        console.log(`📊 Public Tables Count: ${tableRes.rows[0].count}`);

        await client.end();
        process.exit(0);
    } catch (err) {
        console.error('❌ Connection Failed:', err.message);
        if (err.code) console.error('   Code:', err.code);
        if (err.address) console.error('   Address:', err.address);
        if (err.port) console.error('   Port:', err.port);
        process.exit(1);
    }
}

testConnection();
