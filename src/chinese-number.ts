// 中文数字 → 整数（1~31 范围）。
// 支持阿拉伯数字，以及常见中文写法（含农历的「初X」「廿X」「卅」等）。

const DIGIT: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

export function parseSmallInt(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;

  if (/^\d+$/.test(s)) {
    const n = Number.parseInt(s, 10);
    return Number.isInteger(n) ? n : null;
  }

  // 农历日期常见「初X」：初五=5、初十=10。
  const t = s.replace(/^初/, "");

  if (t === "十") return 10;
  if (t === "廿") return 20;
  if (t === "卅") return 30;

  if (t.startsWith("廿")) {
    const unit = DIGIT[t[1]];
    if (unit !== undefined) return 20 + unit; // 廿一~廿九
    return null;
  }
  if (t.startsWith("十")) {
    const unit = DIGIT[t[1]];
    if (unit !== undefined) return 10 + unit; // 十一~十九
    return null;
  }
  if (t.endsWith("十")) {
    const tens = DIGIT[t[0]];
    if (tens !== undefined) return tens * 10; // 二十、三十
    return null;
  }
  if (t.includes("十")) {
    const [a, b] = t.split("十");
    const tens = DIGIT[a];
    const unit = DIGIT[b];
    if (tens !== undefined && unit !== undefined) return tens * 10 + unit; // 二十五
    return null;
  }
  if (t.length === 1 && DIGIT[t] !== undefined) return DIGIT[t];
  return null;
}

// 农历月份别名：正=1、冬=11、腊=12。
const MONTH_ALIAS: Record<string, number> = { 正: 1, 冬: 11, 腊: 12 };

export function parseMonth(raw: string): number | null {
  const s = raw.trim().replace(/月$/, "");
  const alias = MONTH_ALIAS[s];
  if (alias !== undefined) return alias;
  const n = parseSmallInt(s);
  if (n === null || n < 1 || n > 12) return null;
  return n;
}

export function parseDay(raw: string, isLunar: boolean): number | null {
  const s = raw.trim().replace(/日$/, "");
  const n = parseSmallInt(s);
  const max = isLunar ? 30 : 31;
  if (n === null || n < 1 || n > max) return null;
  return n;
}
