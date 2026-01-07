import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from '../src/lib/server/db/schema.ts';
import { hash } from '@node-rs/argon2';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { eq } from 'drizzle-orm';
import * as readline from 'readline';

if (!process.env.SQLITE_URI || !process.env.SQLITE_AUTH_TOKEN) {
	throw new Error('DATABASE_URL environment variable is not set');
}

const client = createClient({
	url: process.env.SQLITE_URI,
	authToken: process.env.SQLITE_AUTH_TOKEN
});
const db = drizzle(client, { schema });

function generateUserId() {
	// ID with 120 bits of entropy, or about the same as UUID v4.
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	const id = encodeBase32LowerCase(bytes);
	return id;
}

function validateUsername(username: string): boolean {
	return (
		typeof username === 'string' &&
		username.length >= 3 &&
		username.length <= 31 &&
		/^[a-z0-9_-]+$/.test(username)
	);
}

function validatePassword(password: string): boolean {
	return typeof password === 'string' && password.length >= 6 && password.length <= 255;
}

function prompt(question: string): Promise<string> {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});

	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			rl.close();
			resolve(answer);
		});
	});
}

async function createAdmin() {
	try {
		console.log('🔐 Admin User Creation Script\n');

		// Get username from command line args or prompt
		let username = process.argv[2];
		if (!username) {
			username = await prompt('Enter username (min 3, max 31 characters, alphanumeric only): ');
		}

		if (!validateUsername(username)) {
			console.error('❌ Invalid username (min 3, max 31 characters, alphanumeric only)');
			process.exit(1);
		}

		// Check if user already exists
		const existingUsers = await db
			.select()
			.from(schema.user)
			.where(eq(schema.user.username, username));
		if (existingUsers.length > 0) {
			console.error(`❌ User "${username}" already exists!`);
			process.exit(1);
		}

		// Get password from command line args or prompt
		let password = process.argv[3];
		if (!password) {
			console.log('⚠️  Note: Password will be visible as you type');
			password = await prompt('Enter password (min 6 characters): ');
		}

		if (!validatePassword(password)) {
			console.error('❌ Invalid password (min 6, max 255 characters)');
			process.exit(1);
		}

		// Generate user ID
		const userId = generateUserId();

		// Hash password
		console.log('🔒 Hashing password...');
		const passwordHash = await hash(password, {
			// recommended minimum parameters
			memoryCost: 19456,
			timeCost: 2,
			outputLen: 32,
			parallelism: 1
		});

		// Create user
		console.log('👤 Creating admin user...');
		await db.insert(schema.user).values({
			id: userId,
			username,
			passwordHash
		});

		console.log(`✅ Admin user "${username}" created successfully!`);
		console.log(`   User ID: ${userId}`);
	} catch (error) {
		console.error('❌ Error creating admin user:', error);
		process.exit(1);
	} finally {
		await client.end();
	}
}

createAdmin();
