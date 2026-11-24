import type { Block, PrintDocument, TestPageData } from '../document/types.js';
import { DEFAULT_TZ, formatDateTime } from './format.js';

/** Dong mau theo tieu chi nghiem thu A8.1 cua dac ta */
export const SAMPLE_VN_LINE = 'Hồ sơ: Nguyễn Thị Hương, Cà phê sữa đá, Bánh mì thịt nướng, Lẩu thái hải sản, ĐỔI BÀN';

/** Phieu thu: kiem tra thuoc do cot, chu co dau, kich thuoc chu, QR, cat giay */
export function buildTestPage(d: TestPageData = {}): PrintDocument {
  const tz = d.timeZone ?? DEFAULT_TZ;
  const blocks: Block[] = [
    { t: 'text', s: 'INNOORDER - IN THỬ', align: 'center', size: 'tall', bold: true },
    { t: 'text', s: d.printerName ? `Máy in: ${d.printerName}` : 'Máy in', align: 'center' },
    { t: 'text', s: formatDateTime(d.at, tz), align: 'center' },
    { t: 'sep', c: '=' },
    { t: 'text', s: '123456789012345678901234567890123456789012345678', hang: 0 },
    { t: 'text', s: SAMPLE_VN_LINE },
    { t: 'text', s: 'aàáảãạ ăằắẳẵặ âầấẩẫậ eèéẻẽẹ êềếểễệ' },
    { t: 'text', s: 'iìíỉĩị oòóỏõọ ôồốổỗộ ơờớởỡợ' },
    { t: 'text', s: 'uùúủũụ ưừứửữự yỳýỷỹỵ đ ĐĂÂÊÔƠƯ' },
    { t: 'sep', c: '-' },
    { t: 'text', s: 'Chữ đậm BÀN B05', bold: true },
    { t: 'text', s: 'Chữ cao ĐỢT 2', size: 'tall', bold: true },
    { t: 'text', s: 'BÀN B05', size: 'big', bold: true, align: 'center' },
    { t: 'kv', l: 'Tạm tính', r: '1.250.000' },
    { t: 'kv', l: 'TỔNG CỘNG', r: '1.250.000đ', bold: true },
  ];
  if (d.qr) blocks.push({ t: 'sep', c: '-' }, { t: 'qr', d: d.qr, size: 5 });
  blocks.push(
    { t: 'sep', c: '=' },
    { t: 'text', s: 'Nếu chữ trên hiển thị đúng 100% dấu thì máy in đã sẵn sàng.', align: 'center' },
    { t: 'feed', n: 1 },
    { t: 'cut' },
  );
  return { v: 1, blocks };
}
