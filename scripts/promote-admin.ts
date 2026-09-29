import { eq } from 'drizzle-orm';

import { closeDatabase, db } from '../src/database/client';
import { users } from '../src/database/schema';

async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();

  if (!email) {
    console.error('Uso: npm run admin:promote -- admin@eslagames.com');
    process.exitCode = 1;
  } else {
    try {
      const [user] = await db
        .update(users)
        .set({ role: 'admin', updatedAt: new Date() })
        .where(eq(users.email, email))
        .returning({ id: users.id, email: users.email, displayName: users.displayName });

      if (!user) {
        console.error(`No existe un usuario registrado con el email ${email}.`);
        process.exitCode = 1;
      } else {
        console.log(`Cuenta promovida a super admin: ${user.displayName} <${user.email}>`);
      }
    } finally {
      await closeDatabase();
    }
  }
}

void main();
