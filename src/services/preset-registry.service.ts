import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Preset, PresetSchema } from '../domain/schemas.js';

export class PresetRegistryService {
  private presets: Map<string, Preset> = new Map();
  private presetsDir: string;

  constructor(customPresetsDir?: string) {
    if (customPresetsDir && fs.existsSync(customPresetsDir)) {
      this.presetsDir = customPresetsDir;
    } else {
      this.presetsDir = this.findPresetsDir();
    }
    this.reloadPresets();
  }

  private findPresetsDir(): string {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    let dir = currentDir;
    for (let i = 0; i < 5; i++) {
      const candidate = path.join(dir, 'presets');
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        return candidate;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    // Fallback
    return path.resolve(currentDir, '../../presets');
  }

  public reloadPresets(): void {
    this.presets.clear();
    if (!fs.existsSync(this.presetsDir)) {
      throw new Error(`Presets directory not found at: ${this.presetsDir}`);
    }

    const files = fs.readdirSync(this.presetsDir).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      const filePath = path.join(this.presetsDir, file);
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        const validated = PresetSchema.parse(parsed);
        this.presets.set(validated.id, validated);
      } catch (err: any) {
        console.error(`[PresetRegistryService] Failed to load preset ${file}:`, err.message);
      }
    }
  }

  public getAllPresets(): Preset[] {
    return Array.from(this.presets.values());
  }

  public getPresetIds(): string[] {
    return Array.from(this.presets.keys());
  }

  public getPresetById(id: string): Preset | undefined {
    return this.presets.get(id);
  }

  public getPresetsDir(): string {
    return this.presetsDir;
  }
}

