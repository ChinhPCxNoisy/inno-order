import { ValidationError } from '@nestjs/common';

const VI_CHARS = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;

/** Thong bao mac dinh (tieng Anh) cua class-validator -> tieng Viet co dau theo ten rang buoc */
export function viMessage(constraint: string, path: string, msg: string): string {
  if (VI_CHARS.test(msg)) return msg; // tin tieng Viet tu DTO giu nguyen
  const n = (msg.match(/-?\d+(?:\.\d+)?/g) ?? []).pop() ?? '';
  const f = `Trường "${path}"`;
  switch (constraint) {
    case 'isInt': return `${f} phải là số nguyên`;
    case 'isNumber':
      if (/maximum of 0 decimal/.test(msg)) return `${f} phải là số nguyên (không có phần lẻ)`;
      return `${f} phải là số hợp lệ (đúng số chữ số thập phân cho phép)`;
    case 'isString': return `${f} phải là chuỗi ký tự`;
    case 'isBoolean': return `${f} phải là true hoặc false`;
    case 'isArray': return `${f} phải là danh sách`;
    case 'isObject': return `${f} phải là một đối tượng`;
    case 'isNotEmpty': return `${f} không được để trống`;
    case 'isDefined': return `${f} là bắt buộc`;
    case 'isUuid': return `${f} không phải mã hợp lệ`;
    case 'isIn':
    case 'isEnum': return `${f} có giá trị không hợp lệ`;
    case 'isDateString': return `${f} không phải ngày hợp lệ`;
    case 'isEmail': return `${f} không phải email hợp lệ`;
    case 'min': return `${f} không được nhỏ hơn ${n}`;
    case 'max': return `${f} không được lớn hơn ${n}`;
    case 'minLength': return `${f} tối thiểu ${n} ký tự`;
    case 'maxLength': return `${f} tối đa ${n} ký tự`;
    case 'arrayMinSize': return `${f} cần ít nhất ${n} phần tử`;
    case 'arrayMaxSize': return `${f} tối đa ${n} phần tử`;
    case 'matches': return `${f} sai định dạng`;
    case 'whitelistValidation': return `${f} không được phép gửi`;
    default: return `${f} không hợp lệ`;
  }
}

/** Lam phang loi validate (giu duong dan items.0.note ...) va Viet hoa thong bao mac dinh */
export function flattenErrors(errors: ValidationError[], parent = ''): string[] {
  const out: string[] = [];
  for (const e of errors) {
    const path = parent ? `${parent}.${e.property}` : e.property;
    for (const [c, m] of Object.entries(e.constraints ?? {})) out.push(viMessage(c, path, m));
    if (e.children?.length) out.push(...flattenErrors(e.children, path));
  }
  return out;
}
