import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { GlobalConfig } from './types.js';

const DEFAULT_CONFIG: GlobalConfig = {
  learnDir: path.join(os.homedir(), 'Learn'),
  defaultGitDepth: 1,
  jinaApiKey: null,
  editor: process.env.EDITOR || 'vim',
  features: {
    autoIngest: false,
    preserveProvenance: true,
  },
};

export class ConfigManager {
  private configDir: string;
  private configPath: string;
  private config: GlobalConfig | null = null;

  constructor(configDir?: string) {
    this.configDir = configDir || path.join(os.homedir(), '.learn');
    this.configPath = path.join(this.configDir, 'config.yaml');
  }

  /**
   * Initialize config directory and file if they don't exist
   */
  async init(): Promise<void> {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }

    if (!fs.existsSync(this.configPath)) {
      const yamlContent = yaml.dump(DEFAULT_CONFIG, { indent: 2 });
      fs.writeFileSync(this.configPath, yamlContent, 'utf-8');
    }
  }

  /**
   * Load config from disk
   */
  async load(): Promise<GlobalConfig> {
    if (this.config) {
      return this.config;
    }

    await this.init();

    const content = fs.readFileSync(this.configPath, 'utf-8');
    this.config = yaml.load(content) as GlobalConfig;
    return this.config;
  }

  /**
   * Save config to disk
   */
  async save(config: GlobalConfig): Promise<void> {
    await this.init();
    const yamlContent = yaml.dump(config, { indent: 2 });
    fs.writeFileSync(this.configPath, yamlContent, 'utf-8');
    this.config = config;
  }

  /**
   * Get a config value
   */
  async get<K extends keyof GlobalConfig>(key: K): Promise<GlobalConfig[K]> {
    const config = await this.load();
    return config[key];
  }

  /**
   * Set a config value
   */
  async set<K extends keyof GlobalConfig>(
    key: K,
    value: GlobalConfig[K]
  ): Promise<void> {
    const config = await this.load();
    config[key] = value;
    await this.save(config);
  }

  /**
   * Get the learn directory (expand ~ if needed)
   */
  async getLearnDir(): Promise<string> {
    const learnDir = await this.get('learnDir');
    return learnDir.replace(/^~/, os.homedir());
  }

  /**
   * Reset config to defaults
   */
  async reset(): Promise<void> {
    await this.save(DEFAULT_CONFIG);
  }
}

export const configManager = new ConfigManager();
