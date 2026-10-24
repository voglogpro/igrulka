// Editorial summaries describe existing roles; combat numbers remain in the engine config.
export const UNIT_PROFILES = {
  infantry: ['Линейная пехота', 'Захват районов · прикрытие', 'rifle'],
  machinegunner: ['Огневая поддержка', 'Подавление пехоты с позиции', 'machinegun'],
  sniper: ['Дальний огонь', 'Пехота · наблюдение', 'sniper'],
  assault: ['Штурм', 'Ближний бой · здания', 'assault'],
  atgm: ['Противотанковый расчёт', 'Бронетехника · огонь с места', 'missile'],
  engineer: ['Инженер', 'Окопы · ремонт техники', 'engineer'],
  operator: ['Оператор FPV', 'Точечный удар дроном', 'drone'],
  medic: ['Медицинская помощь', 'Поднимает раненых · без оружия', 'medic'],
  supplytruck: ['Снабжение', 'Ремонт · боезапас · без оружия', 'truck'],
  armoredcar: ['Разведка', 'Пехота · высокая скорость', 'car'],
  apc: ['Транспорт', '8 мест · пулемётное прикрытие', 'apc'],
  ifv: ['Боевая машина пехоты', '6 мест · 30-мм пушка', 'ifv'],
  lighttank: ['Лёгкая броня', 'Пехота · лёгкая техника', 'lighttank'],
  leopard: ['Основной танк', 'Наземные войска · здания', 'tank'],
  heavytank: ['Прорыв', 'Тяжёлая броня · 125-мм пушка', 'heavytank'],
  tankdestroyer: ['Противотанковая машина', 'Броня · дальний ракетный огонь', 'tankmissile'],
  howitzer: ['Гаубица', 'Навесной огонь · до 560 м', 'howitzer'],
  mlrs: ['Реактивная артиллерия', 'Площадной залп · до 650 м', 'mlrs'],
  mog: ['Пулемётный расчёт', 'Позиционная оборона · дроны', 'mog'],
  shilka: ['Мобильное ПВО', 'Дроны · четыре ствола', 'shilka'],
  gepard: ['Мобильное ПВО', 'Дроны · точный огонь', 'gepard'],
};

const soldier =
  '<path d="M29 24c0-6 17-6 17 0v5H29zM32 31h11l4 18-6 2-2-12-3 1-3 15-7-1 4-17-7 6-4-4z"/><circle cx="38" cy="17" r="6"/>';
const track =
  '<path d="M22 43h63l8 8-6 7H22l-8-7z"/><path d="M24 47h60l4 4-4 3H24l-5-3z" fill="var(--unit-cutout,#1b292b)"/><circle cx="29" cy="51" r="3"/><circle cx="42" cy="51" r="3"/><circle cx="55" cy="51" r="3"/><circle cx="68" cy="51" r="3"/><circle cx="81" cy="51" r="3"/>';
const hull = '<path d="M22 42l8-10h45l12 10z"/>';
const turret = '<path d="M41 31l5-12h22l10 9-7 5zM68 21h37v4H68z"/>';
const tires = '<circle cx="32" cy="52" r="6"/><circle cx="76" cy="52" r="6"/>';
const paths = {
  rifle: soldier + '<path d="M38 31l25-4 1 4-26 7zM56 25h19v3H56z"/>',
  machinegun:
    soldier + '<path d="M38 30h43v5H38zM71 35l7 18h-3l-6-16-5 16h-3l6-18zM48 35h10v7H48z"/>',
  sniper: soldier + '<path d="M38 30h53v3H38zM56 25h16v3H56zM51 33l-4 9-4-2 3-7z"/>',
  assault:
    soldier +
    '<path d="M38 30h28v5H38zM51 35l-3 9-4-2 2-7z"/><path d="M56 50l7-12h8l5 16h-6l-3-9-5 10z" opacity=".5"/><circle cx="67" cy="31" r="5" opacity=".5"/>',
  missile: soldier + '<path d="M40 28l4-8 35 1 7 5-8 5zM60 31l-7 23h4l6-17 7 17h4l-9-23z"/>',
  engineer: soldier + '<path d="M62 16l7 2-3 7 5 5 7-3 2 7-9 4-7-4-10 19-5-3 11-20-3-7z"/>',
  drone:
    soldier +
    '<path d="M59 15h24v4H59zM69 6h4v23h-4z"/><ellipse cx="60" cy="8" rx="9" ry="2"/><ellipse cx="83" cy="8" rx="9" ry="2"/><ellipse cx="60" cy="27" rx="9" ry="2"/><ellipse cx="83" cy="27" rx="9" ry="2"/>',
  medic:
    soldier +
    '<path d="M58 33h25v21H58z"/><path d="M68 37h5v13h-5zM64 41h13v5H64z" fill="var(--unit-cutout,#1b292b)"/>',
  mog: '<path d="M32 34h54v6H32zM48 29h12v5H48zM55 40v15h-5V40zM38 55h30v4H38zM24 39h13v10H24z"/><circle cx="27" cy="29" r="6"/>',
  car:
    '<path d="M20 40l9-9h20l6-10h17l12 19h9v10H20z"/><path d="M58 25h11l7 12H58z" fill="var(--unit-cutout,#1b292b)"/>' +
    tires +
    '<path d="M47 28h26v3H47z"/>',
  apc:
    '<path d="M20 32h55l17 13v7H20zM34 26h20v6H34zM49 27h31v3H49z"/>' +
    tires +
    '<circle cx="54" cy="52" r="6"/>',
  truck:
    '<path d="M19 25h44v25H19zM66 32h16l12 14v5H66z"/><path d="M71 35h8l9 10H71z" fill="var(--unit-cutout,#1b292b)"/>' +
    tires +
    '<path d="M37 31h7v13h-7zM34 34h13v7H34z" fill="var(--unit-cutout,#1b292b)"/>',
  lighttank: track + hull + '<path d="M43 32l3-10h21l8 10zM65 25h35v4H65z"/>',
  ifv: track + hull + '<path d="M42 31l4-13h20l8 13zM65 20h31v4H65zM32 35h7v4h-7z"/>',
  tank: track + hull + turret,
  heavytank: track + hull + turret + '<path d="M22 38h13v7H22zM72 36h13v9H72zM45 16h23v4H45z"/>',
  tankmissile:
    track + hull + '<path d="M47 30V18h25v12zM59 16l29-7 1 5-29 8zM60 24l29-7 1 5-29 8z"/>',
  howitzer: track + hull + '<path d="M39 32V17h27l9 16zM60 19L96 4l2 5-37 16z"/>',
  mlrs:
    track +
    hull +
    '<path d="M38 28L75 8l8 16-36 20z"/><path d="M45 29L76 12m-29 24 31-17" fill="none" stroke="var(--unit-cutout,#1b292b)" stroke-width="2"/>',
  shilka:
    track +
    hull +
    '<path d="M43 32V18h23v14zM59 18l30-9 1 3-29 10zM60 24l30-9 1 3-29 10zM43 15h5V8h-5z"/>',
  gepard:
    track +
    hull +
    '<path d="M43 32V19h25v13zM39 23l51-13 1 3-51 15zM43 28l50-13 1 3-51 15z"/><circle cx="52" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="3"/>',
};

export function unitIllustration(key) {
  const silhouette = UNIT_PROFILES[key]?.[2] || 'rifle';
  return `<svg class="unit-illustration" viewBox="0 0 120 64" fill="currentColor" aria-hidden="true"><path d="M14 60h92" fill="none" stroke="currentColor" stroke-width=".5" opacity=".25"/>${paths[silhouette]}</svg>`;
}
