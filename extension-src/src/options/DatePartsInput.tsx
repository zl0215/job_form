import React from 'react';

interface Props {
  value: string;
  onChange: (value: string) => void;
  precision?: 'year' | 'month' | 'day';
  allowPresent?: boolean;
}

function parse(value: string): { year: string; month: string; day: string; present: boolean } {
  const trimmed = value.trim();
  if (/至今|现在|present|current/i.test(trimmed)) {
    return { year: '', month: '', day: '', present: true };
  }
  const match = trimmed.match(/(19|20)\d{2}(?:\D+(\d{1,2}))?(?:\D+(\d{1,2}))?/);
  return {
    year: match?.[0]?.slice(0, 4) || '',
    month: match?.[2] ? String(Number(match[2])) : '',
    day: match?.[3] ? String(Number(match[3])) : '',
    present: false,
  };
}

function format(year: string, month: string, day: string, precision: 'year' | 'month' | 'day'): string {
  if (!year) return '';
  if (precision === 'year') return year;
  if (!month) return year;
  const base = `${year}-${month.padStart(2, '0')}`;
  return precision === 'day' && day ? `${base}-${day.padStart(2, '0')}` : base;
}

export function DatePartsInput({ value, onChange, precision = 'month', allowPresent = false }: Props) {
  const parts = parse(value);
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: currentYear + 10 - 1950 + 1 }, (_, index) => currentYear + 10 - index);
  const months = Array.from({ length: 12 }, (_, index) => index + 1);
  const maxDay = parts.year && parts.month
    ? new Date(Number(parts.year), Number(parts.month), 0).getDate()
    : 31;
  const days = Array.from({ length: maxDay }, (_, index) => index + 1);

  const update = (next: Partial<typeof parts>) => {
    const merged = { ...parts, ...next, present: false };
    onChange(format(merged.year, merged.month, merged.day, precision));
  };

  return (
    <div className="date-parts-input">
      <select value={parts.year} disabled={parts.present} onChange={event => update({ year: event.target.value })} aria-label="年">
        <option value="">年</option>
        {years.map(year => <option key={year} value={year}>{year}</option>)}
      </select>
      {precision !== 'year' && (
        <select value={parts.month} disabled={parts.present || !parts.year} onChange={event => update({ month: event.target.value })} aria-label="月">
          <option value="">月</option>
          {months.map(month => <option key={month} value={month}>{month}月</option>)}
        </select>
      )}
      {precision === 'day' && (
        <select value={parts.day} disabled={parts.present || !parts.month} onChange={event => update({ day: event.target.value })} aria-label="日">
          <option value="">日（可不填）</option>
          {days.map(day => <option key={day} value={day}>{day}日</option>)}
        </select>
      )}
      {allowPresent && (
        <label className="date-present-toggle">
          <input type="checkbox" checked={parts.present} onChange={event => onChange(event.target.checked ? '至今' : '')} />
          至今
        </label>
      )}
    </div>
  );
}
