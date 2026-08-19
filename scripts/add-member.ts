import type { FamilyMember } from "../src/types";

/**
 * 新增队员到 birthdays.json。
 * 用法：bun run add-member "姓名" 历法 月 日 [关系]
 *   例：bun run add-member "王嘉仪" solar 8 31
 *   例：bun run add-member "李贝芊" lunar 2 28 队友
 * 历法：solar=阳历 / lunar=农历；关系默认「队友」。
 * 新增后，下次「每日提醒」和「查询」会自动包含 TA。
 */
const FILE = "birthdays.json";

function fail(msg: string): never {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

function parseType(raw: string): "solar" | "lunar" {
  const t = raw.trim().toLowerCase();
  if (t === "solar" || t === "阳历" || t === "公历") return "solar";
  if (t === "lunar" || t === "农历" || t === "阴历") return "lunar";
  return fail(`历法只支持 solar（阳历）或 lunar（农历），收到「${raw}」`);
}

function parseIntStrict(
  raw: string,
  label: string,
  min: number,
  max: number,
): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    return fail(`${label} 必须是 ${min}~${max} 的整数，收到「${raw}」`);
  }
  return n;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 4) {
    console.log(
      [
        '用法：bun run add-member "姓名" 历法 月 日 [关系]',
        '  例：bun run add-member "王嘉仪" solar 8 31',
        '  例：bun run add-member "李贝芊" lunar 2 28 队友',
        "  历法：solar=阳历 / lunar=农历；关系默认「队友」。",
      ].join("\n"),
    );
    process.exit(1);
  }

  const [name, typeRaw, monthRaw, dayRaw, relation = "队友"] = args;
  const birthdayType = parseType(typeRaw);
  const birthMonth = parseIntStrict(monthRaw, "月份", 1, 12);
  // 农历没有 31 日，上限 30。
  const birthDay = parseIntStrict(
    dayRaw,
    "日期",
    1,
    birthdayType === "lunar" ? 30 : 31,
  );

  const file = Bun.file(FILE);
  if (!(await file.exists())) {
    fail(`找不到 ${FILE}，请先创建它（可复制 birthdays.example.json）`);
  }

  const list = (await file.json()) as FamilyMember[];

  if (list.some((m) => m.name === name.trim())) {
    fail(`「${name.trim()}」已在名单里，无需重复添加`);
  }

  // 生成新 id：取现有数字 id 最大值 + 1，形如 m059。
  const maxNum = list.reduce((max, m) => {
    const n = Number.parseInt((m.id ?? "").replace(/\D/g, ""), 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);

  const member: FamilyMember = {
    id: `m${String(maxNum + 1).padStart(3, "0")}`,
    parentId: null,
    spouseId: null,
    familyName: name.trim().charAt(0),
    generation: 1,
    name: name.trim(),
    relation: relation.trim() || "队友",
    birthYear: null,
    birthdayType,
    birthMonth,
    birthDay,
  };

  list.push(member);
  await Bun.write(FILE, `${JSON.stringify(list, null, 2)}\n`);

  const typeLabel = birthdayType === "solar" ? "阳历" : "农历";
  console.log(
    `✅ 已新增：${member.name}（${typeLabel}${birthMonth}月${birthDay}日，关系：${member.relation}）`,
  );
  console.log("下次「每日提醒」和「查询」会自动包含 TA。");
}

main().catch((err) => {
  console.error("❌", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
