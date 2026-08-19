import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { FamilyMember } from "./types";

// 微信里「自助新增/修改」的成员单独落在 overlay 文件，不直接改主名单：
// - 本地主名单 = birthdays.json（人手工维护）
// - 云端主名单 = BIRTHDAYS_JSON Secret（运行时不可写）
// overlay 放在 .runtime/ 下：本地持久化到磁盘；云端随 Actions Cache 一起保存/恢复。
const OVERLAY_FILE = ".runtime/birthdays-overlay.json";

export async function loadOverlay(): Promise<FamilyMember[]> {
  try {
    const file = Bun.file(OVERLAY_FILE);
    if (!(await file.exists())) return [];
    const parsed = (await file.json()) as unknown;
    return Array.isArray(parsed) ? (parsed as FamilyMember[]) : [];
  } catch {
    return [];
  }
}

// 把某个成员写入 overlay（同 id 覆盖，否则追加）。
export async function persistMember(member: FamilyMember): Promise<void> {
  const overlay = await loadOverlay();
  const idx = overlay.findIndex((m) => m.id === member.id);
  if (idx >= 0) overlay[idx] = member;
  else overlay.push(member);

  await mkdir(dirname(OVERLAY_FILE), { recursive: true });
  await Bun.write(OVERLAY_FILE, `${JSON.stringify(overlay, null, 2)}\n`);
}
