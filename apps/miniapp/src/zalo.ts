// Dang nhap Zalo that qua zmp-sdk — chi hoat dong khi chay trong webview Zalo that
// (zmp start mo ban gia lap tren trinh duyet, cac API nay co the tra loi khac/loi).
//
// zmp-sdk/apis that co: getAccessToken(), getUserID(), getUserInfo(), authorize().
// Theo tai lieu zmp-sdk: tu SDK 2.35.0, app mac dinh co quyen lay access token +
// userID ma KHONG can khach xac nhan; muon lay Ten/Anh dai dien (getUserInfo) thi
// phai xin quyen truoc (authorize voi scope.userInfo) de tuan thu Nghi dinh
// 13/2023/NĐ-CP ve bao ve du lieu ca nhan.
//
// Luu y bao mat: getUserID() tra ve gia tri da duoc "cau noi" (bridge) cua app
// Zalo that xac nhan — trinh duyet/devtools thuong khong gia mao duoc vi khong co
// cau noi native nay. Nhung day CHUA phai xac thuc chu ky server-side (ID token
// JWT) — zmp-sdk co getIDToken() cho viec nay nhung tai lieu xac minh server
// (JWKS / endpoint xac thuc) chua tim duoc nguon chinh thuc ro rang luc viet code
// nay; neu can muc bao mat cao hon (chan tuyet doi nhan vien tu danh gia), nen
// tra cuu tai lieu Zalo Mini App chinh thuc (mini.zalo.me/documents) de bo sung
// xac thuc chu ky server-side truoc khi dua vao san xuat quy mo lon.

import { authorize, getAccessToken, getIDToken, getUserID, getUserInfo } from 'zmp-sdk';

export function isInZaloMiniApp(): boolean {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  return /zalo/i.test(ua);
}

export interface ZaloUserInfo {
  zaloUserId: string;
  idToken?: string;
  name?: string;
  avatar?: string;
}

/**
 * Lay dinh danh Zalo cua khach (BRD FR-AUTH-07).
 * Chi goi khi khach chu dong bam "Dang nhap Zalo" (man hinh Profile) hoac khi
 * can gan dinh danh cho 1 hanh dong nhay cam (vd: gui danh gia nhan vien).
 */
export async function zaloLogin(): Promise<ZaloUserInfo | null> {
  try {
    const userId = await getUserID({});
    if (!userId) return null;

    let name: string | undefined;
    let avatar: string | undefined;
    try {
      // Xin quyen Ten/Anh dai dien — khach co the tu choi, van dung duoc userId
      await authorize({ scopes: ['scope.userInfo'] });
      const { userInfo } = await getUserInfo({ autoRequestPermission: true });
      name = userInfo?.name;
      avatar = userInfo?.avatar;
    } catch {
      // Khach tu choi cap quyen Ten/Anh — bo qua, van coi la da dang nhap
    }

    let idToken: string | undefined;
    try {
      idToken = await getIDToken({});
    } catch {
      // Khong lay duoc id token (vd: ban SDK cu) — khong chan luong dang nhap
    }

    return { zaloUserId: userId, idToken, name, avatar };
  } catch {
    return null;
  }
}

/** Lay nhanh access token hien tai (dung khi can gui kem 1 hanh dong, vd gui danh gia) */
export async function getZaloAccessToken(): Promise<string | null> {
  try {
    return (await getAccessToken({})) || null;
  } catch {
    return null;
  }
}

/**
 * Lay zaloUserId "am tham" (khong xin quyen Ten/Anh, khong hien hop thoai) de gan vao
 * 1 hanh dong nhay cam nhu gui danh gia nhan vien (BRD FR-AUTH-07, chong gian lan).
 * Tra ve null ngay neu khong chay trong Zalo (vd mo bang trinh duyet thuong) — khong
 * chan luong danh gia cua khach, chi la "bonus" xac thuc khi co the lay duoc.
 */
export async function getZaloUserId(): Promise<string | null> {
  try {
    const userId = await getUserID({});
    return userId || null;
  } catch {
    return null;
  }
}
