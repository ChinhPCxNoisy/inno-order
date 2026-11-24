import * as dotenv from 'dotenv';
import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

dotenv.config({ path: ['.env', '../../.env'] });

const prisma = new PrismaClient();

const STORE_SLUG = 'bunbohuong';
const QR_BASE = process.env.QR_BASE_URL ?? 'http://localhost:3000';

async function main() {
  const hash = async (pw: string) => bcrypt.hash(pw, 10);

  // ---------- Super Admin (InnoCom) ----------
  const existingAdmin = await prisma.user.findFirst({
    where: { email: 'admin@innoorder.com', role: UserRole.SUPER_ADMIN },
  });
  if (!existingAdmin) {
    await prisma.user.create({
      data: {
        storeId: null,
        name: 'Super Admin',
        email: 'admin@innoorder.com',
        passwordHash: await hash('Admin123!'),
        role: UserRole.SUPER_ADMIN,
      },
    });
  }

  // ---------- Store demo ----------
  const store = await prisma.store.upsert({
    where: { slug: STORE_SLUG },
    update: {},
    create: {
      name: 'Quán Bún Bò Hương',
      slug: STORE_SLUG,
      phone: '0901234567',
      address: '123 Nguyễn Huệ, Quận 1, TP.HCM',
      status: 'ACTIVE',
      settings: {
        rounding: 'nearest_100',
        vatEnabled: false,
        openTime: '07:00',
        closeTime: '22:00',
      },
    },
  });

  // ---------- Users quán ----------
  const users = [
    { name: 'Chủ Quán', email: 'owner@bunbohuong.com', phone: '0901111111', role: UserRole.OWNER, pw: 'Owner123!' },
    { name: 'Thu Ngân Lan', email: 'cashier@bunbohuong.com', phone: '0902222222', role: UserRole.CASHIER, pw: 'Cashier123!' },
    { name: 'Phục Vụ Toàn', email: 'waiter@bunbohuong.com', phone: '0903333333', role: UserRole.WAITER, pw: 'Waiter123!' },
    { name: 'Bếp Trưởng Hải', email: 'kitchen@bunbohuong.com', phone: '0904444444', role: UserRole.KITCHEN, pw: 'Kitchen123!' },
  ];
  for (const u of users) {
    await prisma.user.upsert({
      where: { storeId_email: { storeId: store.id, email: u.email } },
      update: {},
      create: { storeId: store.id, name: u.name, email: u.email, phone: u.phone, passwordHash: await hash(u.pw), role: u.role },
    });
  }

  // ---------- Areas ----------
  const getArea = async (name: string, sortOrder: number) => {
    const found = await prisma.area.findFirst({ where: { storeId: store.id, name } });
    return found ?? prisma.area.create({ data: { storeId: store.id, name, sortOrder } });
  };
  const areaInHouse = await getArea('Trong nhà', 1);
  const areaOutdoor = await getArea('Ngoài trời', 2);

  // ---------- Tables ----------
  const tableDefs = [
    { code: 'B01', area: 'Trong nhà', seats: 4 },
    { code: 'B02', area: 'Trong nhà', seats: 4 },
    { code: 'B03', area: 'Trong nhà', seats: 2 },
    { code: 'B04', area: 'Trong nhà', seats: 6 },
    { code: 'B05', area: 'Ngoài trời', seats: 4 },
    { code: 'B06', area: 'Ngoài trời', seats: 2 },
  ];
  for (const t of tableDefs) {
    const area = t.area === 'Trong nhà' ? areaInHouse : areaOutdoor;
    await prisma.table.upsert({
      where: { storeId_code: { storeId: store.id, code: t.code } },
      update: {},
      create: {
        storeId: store.id,
        areaId: area.id,
        code: t.code,
        name: `Bàn ${t.code.slice(1)}`,
        seats: t.seats,
        status: 'AVAILABLE',
        qrCode: `${QR_BASE}/s/${STORE_SLUG}/t/${t.code}`,
      },
    });
  }

  // ---------- Menu categories ----------
  const catDefs = [
    { name: 'Món chính', sortOrder: 1 },
    { name: 'Món ăn kèm', sortOrder: 2 },
    { name: 'Đồ uống', sortOrder: 3 },
  ];
  const cats: Record<string, string> = {};
  for (const c of catDefs) {
    const found = await prisma.menuCategory.findFirst({ where: { storeId: store.id, name: c.name } });
    const cat = found ?? (await prisma.menuCategory.create({ data: { storeId: store.id, name: c.name, sortOrder: c.sortOrder } }));
    cats[c.name] = cat.id;
  }

  // ---------- Menu items ----------
  const itemDefs = [
    { name: 'Bún bò Huế', cat: 'Món chính', price: 65000, prep: 15, desc: 'Bún bò Huế cay chuẩn vị, có thể yêu cầu thêm cay' },
    { name: 'Bún bò Huế chay', cat: 'Món chính', price: 55000, prep: 12, desc: 'Nước dùng rau củ, topping chay' },
    { name: 'Trứng rán', cat: 'Món ăn kèm', price: 15000, prep: 5 },
    { name: 'Tofu chiên', cat: 'Món ăn kèm', price: 20000, prep: 8 },
    { name: 'Trà sữa đá', cat: 'Đồ uống', price: 35000, prep: 3 },
    { name: 'Nước cam tươi', cat: 'Đồ uống', price: 45000, prep: 5 },
  ];
  const itemIds: Record<string, string> = {};
  for (const it of itemDefs) {
    const existing = await prisma.menuItem.findFirst({ where: { storeId: store.id, name: it.name } });
    const item =
      existing ??
      (await prisma.menuItem.create({
        data: {
          storeId: store.id,
          categoryId: cats[it.cat],
          name: it.name,
          description: it.desc,
          price: it.price,
          prepTimeMinutes: it.prep,
          active: true,
        },
      }));
    itemIds[it.name] = item.id;
  }

  // ---------- Options cho Trà sữa đá ----------
  const traSua = itemIds['Trà sữa đá'];
  const optCount = await prisma.menuOption.count({ where: { menuItemId: traSua } });
  if (optCount === 0) {
    await prisma.menuOption.createMany({
      data: [
        { storeId: store.id, menuItemId: traSua, groupName: 'Đường', optionName: 'Đường 0%', extraPrice: 0, isRequired: true, sortOrder: 1 },
        { storeId: store.id, menuItemId: traSua, groupName: 'Đường', optionName: 'Đường 25%', extraPrice: 0, isRequired: true, sortOrder: 2 },
        { storeId: store.id, menuItemId: traSua, groupName: 'Đường', optionName: 'Đường 50%', extraPrice: 0, isRequired: true, sortOrder: 3 },
        { storeId: store.id, menuItemId: traSua, groupName: 'Đường', optionName: 'Đường 75%', extraPrice: 0, isRequired: true, sortOrder: 4 },
        { storeId: store.id, menuItemId: traSua, groupName: 'Đường', optionName: 'Đường 100%', extraPrice: 0, isRequired: true, sortOrder: 5 },
        { storeId: store.id, menuItemId: traSua, groupName: 'Đá', optionName: 'Đá thường', extraPrice: 0, isRequired: true, sortOrder: 1 },
        { storeId: store.id, menuItemId: traSua, groupName: 'Đá', optionName: 'Ít đá', extraPrice: 0, isRequired: true, sortOrder: 2 },
        { storeId: store.id, menuItemId: traSua, groupName: 'Đá', optionName: 'Không đá', extraPrice: 0, isRequired: true, sortOrder: 3 },
      ],
    });
  }

  // ---------- Printer demo ----------
  const printerCount = await prisma.printer.count({ where: { storeId: store.id } });
  if (printerCount === 0) {
    await prisma.printer.createMany({
      data: [
        {
          storeId: store.id,
          name: 'Máy in bếp',
          station: 'KITCHEN',
          connection: 'LAN',
          host: '192.168.1.100',
          port: 9100,
          paperSize: 'P80',
          charsPerLine: 42,
          status: 'OFFLINE',
        },
        {
          storeId: store.id,
          name: 'Máy in bill quầy',
          station: 'CASHIER',
          connection: 'USB',
          deviceName: 'EPSON TM-T88III',
          paperSize: 'P80',
          charsPerLine: 42,
          status: 'OFFLINE',
        },
      ],
    });
  }

  console.log('Seed xong:');
  console.log('  Super admin : admin@innoorder.com / Admin123!');
  console.log(`  Store       : ${store.name} (slug=${store.slug})`);
  console.log('  Owner       : owner@bunbohuong.com / Owner123!');
  console.log('  Cashier     : cashier@bunbohuong.com / Cashier123!');
  console.log('  Waiter      : waiter@bunbohuong.com / Waiter123!');
  console.log('  Kitchen     : kitchen@bunbohuong.com / Kitchen123!');
  console.log('  Tables      : B01-B04 (Trong nha), B05-B06 (Ngoai troi)');
  console.log(`  QR vuichon  : ${QR_BASE}/s/${STORE_SLUG}/t/B01`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
