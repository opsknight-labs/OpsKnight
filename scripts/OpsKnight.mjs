#!/usr/bin/env node
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

function printHelp() {
    const lines = [
        'Usage:',
        '  OpsKnight --user <name> --email <email> --password <password> [--role <role>] [--update]',
        '',
        'Examples:',
        '  OpsKnight --user admin --password admin --email admin@example.com --role admin',
        '',
        'Notes:',
        '  - Role values: admin, responder, user',
        '  - Use --update to update an existing user'
    ];
    console.log(lines.join('\n'));
}

function parseArgs(argv) {
    const options = {};
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (!arg.startsWith('--')) {
            continue;
        }

        const key = arg.slice(2);
        if (key === 'help' || key === 'h') {
            options.help = true;
            continue;
        }
        if (key === 'update') {
            options.update = true;
            continue;
        }

        const value = argv[i + 1];
        if (!value || value.startsWith('--')) {
            throw new Error(`Missing value for --${key}`);
        }

        options[key] = value;
        i += 1;
    }

    return options;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        printHelp();
        return;
    }

    if (!process.env.DATABASE_URL) {
        dotenv.config();
    }

    if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL is required. Set it in the environment or .env.');
    }

    const name = typeof options.user === 'string' ? options.user.trim() : '';
    const email = typeof options.email === 'string' ? options.email.trim().toLowerCase() : '';
    const password = typeof options.password === 'string' ? options.password : '';
    const roleInput = typeof options.role === 'string' ? options.role : 'USER';

    if (!name || !email || !password) {
        throw new Error('Missing required flags. Use --user, --email, and --password.');
    }

    const role = roleInput.toUpperCase();
    const validRoles = new Set(['USER', 'ADMIN', 'RESPONDER']);
    if (!validRoles.has(role)) {
        throw new Error(`Invalid role: ${roleInput}`);
    }

    const prisma = new PrismaClient();

    try {
        const existing = await prisma.user.findUnique({ where: { email } });
        const passwordHash = await bcrypt.hash(password, 10);

        if (existing) {
            if (!options.update) {
                throw new Error('User already exists. Use --update to update the password.');
            }

            await prisma.user.update({
                where: { email },
                data: {
                    name,
                    role,
                    status: 'ACTIVE',
                    passwordHash,
                    invitedAt: null,
                    deactivatedAt: null
                }
            });

            console.log(`Updated user ${email}.`);
        } else {
            await prisma.user.create({
                data: {
                    name,
                    email,
                    role,
                    status: 'ACTIVE',
                    passwordHash,
                    invitedAt: null,
                    deactivatedAt: null
                }
            });

            console.log(`Created user ${email}.`);
        }
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
});


