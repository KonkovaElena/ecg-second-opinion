import type { ReviewerIdentity } from './reviewer-auth';

declare module 'express-serve-static-core' {
  interface Request {
    correlationId: string;
    reviewer?: ReviewerIdentity;
  }
}

export {};