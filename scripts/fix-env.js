const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');

if (!fs.existsSync(envPath)) {
    console.log('⚠️  No .env file found. Copying from env.example...');
    const examplePath = path.join(__dirname, '..', 'env.example');
    if (fs.existsSync(examplePath)) {
        fs.copyFileSync(examplePath, envPath);
    } else {
        console.error('❌ env.example also missing! Cannot fix configuration.');
        process.exit(1);
    }
}

let content = fs.readFileSync(envPath, 'utf8');
let fixed = false;

// Fix 1: Correct Database Hostname
if (content.includes('@localhost:5432')) {
    content = content.replace('@localhost:5432', '@opsknight-db:5432');
    console.log('✅ Updated DATABASE_URL to use "opsknight-db"');
    fixed = true;
}

// Fix 2: Ensure connection limit is valid
if (!content.includes('connection_limit')) {
    // Append minimal robust config if missing
    content += '\n# Added by fix-env script\nDATABASE_URL="${DATABASE_URL}?connection_limit=10"';
}

if (fixed) {
    fs.writeFileSync(envPath, content);
    console.log('🎉 Successfully fixed .env configuration!');
    console.log('👉 Please restart your app: press Ctrl+C then run "npm run dev"');
} else {
    console.log('✅ Configuration already looks correct (hostname is not localhost).');
}
