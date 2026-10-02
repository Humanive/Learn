import { GlobalConfig } from '../types.js';

export interface AdapterResult {
  success: boolean;
  output?: string;
  reason?: string;
}

export interface AdapterContext {
  source: string;
  workspacePath: string;
  config: GlobalConfig;
}

export type Adapter = (context: AdapterContext) => Promise<AdapterResult>;
