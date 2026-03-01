import { readdirSync, existsSync, readFileSync, statSync } from 'fs';
import { join, basename } from 'path';
import { DISCORD_SAFE_LENGTH } from './constants.js';

export interface Skill {
  name: string;
  description: string;
  path: string;
}

/**
 * ワークスペースのスキルディレクトリからスキル一覧を読み込む
 * .claude/skills/, .codex/skills/, skills/ を探し、重複は除外
 */
export function loadSkills(workdir: string): Skill[] {
  const skillMap = new Map<string, Skill>();

  // 複数のスキルディレクトリを探す（優先順位順）
  const skillsDirs = [
    join(workdir, '.claude', 'skills'), // Claude Code形式
    join(workdir, '.codex', 'skills'), // Codex形式
    join(workdir, 'skills'), // 標準形式
  ];

  for (const skillsDir of skillsDirs) {
    const loaded = loadSkillsFromDir(skillsDir);
    for (const skill of loaded) {
      // 同名スキルは最初に見つかったものを優先（重複排除）
      if (!skillMap.has(skill.name)) {
        skillMap.set(skill.name, skill);
      }
    }
  }

  return Array.from(skillMap.values());
}

/**
 * 指定ディレクトリからスキルを読み込む
 */
function loadSkillsFromDir(skillsDir: string): Skill[] {
  const skills: Skill[] = [];

  if (!existsSync(skillsDir)) {
    return skills;
  }

  try {
    const entries = readdirSync(skillsDir);

    for (const entry of entries) {
      const entryPath = join(skillsDir, entry);
      const stat = statSync(entryPath);

      if (stat.isDirectory()) {
        // skills/skill-name/SKILL.md 形式
        const skillFile = join(entryPath, 'SKILL.md');
        if (existsSync(skillFile)) {
          const skill = parseSkillFile(skillFile, entry);
          if (skill) {
            skills.push(skill);
          }
        }
      } else if (entry.endsWith('.md') && entry !== 'README.md') {
        // skills/skill-name.md 形式
        const skillName = basename(entry, '.md');
        const skill = parseSkillFile(entryPath, skillName);
        if (skill) {
          skills.push(skill);
        }
      }
    }
  } catch (err) {
    console.error('[skills] Failed to load skills:', err);
  }

  return skills;
}

/**
 * SKILL.mdファイルをパースしてスキル情報を抽出
 */
function parseSkillFile(filePath: string, defaultName: string): Skill | null {
  try {
    const content = readFileSync(filePath, 'utf-8');

    // フロントマターからdescriptionを抽出
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    let description = '';
    let name = defaultName;

    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];
      const descMatch = frontmatter.match(/description:\s*["']?([^"'\n]+)["']?/);
      const nameMatch = frontmatter.match(/name:\s*["']?([^"'\n]+)["']?/);

      if (descMatch) {
        description = descMatch[1].trim();
      }
      if (nameMatch) {
        name = nameMatch[1].trim();
      }
    }

    // フロントマターがない場合、最初の見出しや段落から説明を取得
    if (!description) {
      const lines = content
        .split('\n')
        .filter((l) => l.trim() && !l.startsWith('#') && !l.startsWith('---'));
      if (lines.length > 0) {
        description = lines[0].slice(0, 100);
      }
    }

    return {
      name,
      description: description || '(説明なし)',
      path: filePath,
    };
  } catch {
    return null;
  }
}

/**
 * スキル一覧をフォーマット（Discord 2000文字制限対応）
 */
export function formatSkillList(skills: Skill[]): string {
  if (skills.length === 0) {
    return '📚 利用可能なスキルはありません\n\n`skills/` ディレクトリにSKILL.mdを追加してください。';
  }

  const lines = [`📚 **利用可能なスキル** (${skills.length}件)`, ''];
  for (const skill of skills) {
    // 説明を50文字に切り詰め
    const shortDesc =
      skill.description.length > 50 ? skill.description.slice(0, 50) + '...' : skill.description;
    lines.push(`• **${skill.name}**: ${shortDesc}`);
  }
  lines.push('', '使い方: `/skill <スキル名>`');

  const result = lines.join('\n');
  // Discord文字数制限対応
  if (result.length > DISCORD_SAFE_LENGTH) {
    const shortLines = [`📚 **利用可能なスキル** (${skills.length}件)`, ''];
    for (const skill of skills) {
      shortLines.push(`• **${skill.name}**`);
    }
    shortLines.push('', '使い方: `/skill <スキル名>`');
    return shortLines.join('\n');
  }
  return result;
}
