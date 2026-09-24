declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        role: 'player' | 'admin';
      };
    }
  }
}

export {};
