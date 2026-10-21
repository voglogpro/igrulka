export const VERSION = 1;
export const UNITS = {
  scout: { name:'«Искра»', label:'Лёгкий дрон', short:'Дрон', cost:65, metal:5, days:1, damage:9, tech:null, icon:'drone', color:'#a8e4ce' },
  bomber: { name:'«Сокол»', label:'Тяжёлый дрон', short:'Тяж. дрон', cost:150, metal:12, days:2, damage:21, tech:'heavy', icon:'drone', color:'#9dc5ef' },
  cruise: { name:'«Стрела»', label:'Крылатая ракета', short:'Крылатая', cost:300, metal:22, days:3, damage:37, tech:'cruise', icon:'rocket', color:'#e8c895' },
  ballistic: { name:'«Орион»', label:'Баллистическая ракета', short:'Баллистика', cost:540, metal:36, days:4, damage:62, tech:'ballistic', icon:'rocket', color:'#c5b4f0' }
};
export const BUILDINGS = {
  housing:{name:'Жилой квартал',short:'Жильё',cost:180,metal:8,days:1,max:30,icon:'city',desc:'+240 жителей и +14 ¤ в день. Потребляет 1 энергию.'},
  commerce:{name:'Торговый центр',short:'Торговля',cost:270,metal:14,days:2,max:20,icon:'wallet',desc:'+38 ¤ в день. Потребляет 2 энергии.'},
  park:{name:'Городской парк',short:'Парк',cost:120,metal:3,days:1,max:15,icon:'heart',desc:'+0,1 доверия в день. Содержание 3 ¤/день.'},
  industry:{name:'Промышленный комплекс',short:'Промышленность',cost:330,metal:22,days:2,max:20,icon:'factory',desc:'+42 к доходу и +4 сплава в день. Потребляет 2 энергии.'},
  energy:{name:'Электростанция',short:'Энергетика',cost:260,metal:17,days:2,max:4,icon:'bolt',desc:'+12 энергии. Повреждения города снижают выработку.'},
  lab:{name:'Исследовательский центр',short:'Научный центр',cost:350,metal:20,days:3,max:4,icon:'science',desc:'+5 науки в день. Потребляет 3 энергии.'},
  shelter:{name:'Защитная инфраструктура',short:'Укрытия',cost:240,metal:18,days:2,max:3,icon:'shield',desc:'−12% урона городу за уровень. Снижает потери доверия.'},
  gun:{name:'Ближний перехват',short:'Ближнее ПВО',cost:220,metal:16,days:1,max:3,icon:'crosshair',desc:'Защита от дронов: +18 п.п. перехвата за уровень. Содержание 12 ¤/день.'},
  sam:{name:'Ракетная батарея',short:'Ракетное ПВО',cost:410,metal:28,days:2,max:3,icon:'shield',tech:'radar',desc:'Защита от дронов и ракет: +25 п.п. перехвата. Прикрывает соседей. 22 ¤/день.'},
  shield:{name:'Система «Заслон»',short:'ПРО «Заслон»',cost:680,metal:42,days:3,max:2,icon:'radar',tech:'abm',desc:'Защита от баллистики: +40 п.п. перехвата. Содержание 32 ¤/день.'}
};
export const TECHS = [
  {id:'heavy',name:'Тяжёлые платформы',branch:'strike',tier:1,cost:100,days:2,requires:[],icon:'drone',desc:'Открывает производство тяжёлых дронов «Сокол».'},
  {id:'cruise',name:'Крылатые системы',branch:'strike',tier:2,cost:230,days:3,requires:['heavy'],icon:'rocket',desc:'Открывает крылатые ракеты «Стрела».'},
  {id:'ballistic',name:'Программа «Орион»',branch:'strike',tier:3,cost:420,days:4,requires:['cruise'],icon:'rocket',desc:'Открывает баллистические ракеты «Орион».'},
  {id:'guidance',name:'Цифровое наведение',branch:'strike',tier:4,cost:320,days:3,requires:['ballistic'],icon:'crosshair',desc:'Урон всех ваших ударных систем увеличивается на 20%.'},
  {id:'radar',name:'Единая сеть радаров',branch:'defense',tier:1,cost:90,days:2,requires:[],icon:'radar',desc:'Открывает ракетное ПВО; +8 п.п. к вероятности перехвата.'},
  {id:'efficiency',name:'Умный перехват',branch:'defense',tier:2,cost:190,days:3,requires:['radar'],icon:'crosshair',desc:'Содержание ПВО снижается на 20%. +6 п.п. к перехвату.'},
  {id:'abm',name:'Противоракетный щит',branch:'defense',tier:3,cost:350,days:4,requires:['efficiency'],icon:'shield',desc:'Открывает систему ПРО «Заслон» против баллистики.'},
  {id:'resilience',name:'Гражданская защита',branch:'defense',tier:4,cost:260,days:3,requires:['abm'],icon:'heart',desc:'Урон вашим городам снижается на 15%; +10 доверия при завершении.'},
  {id:'logistics',name:'Новая логистика',branch:'economy',tier:1,cost:80,days:2,requires:[],icon:'box',desc:'+20% к производству сплавов, +1 место в очереди.'},
  {id:'grid',name:'Умная энергосеть',branch:'economy',tier:2,cost:160,days:2,requires:['logistics'],icon:'bolt',desc:'Выработка энергии увеличивается на 30%.'},
  {id:'automation',name:'Автоматизация',branch:'economy',tier:3,cost:270,days:3,requires:['grid'],icon:'factory',desc:'Доход промышленности увеличивается на 25%.'},
  {id:'science',name:'Научная кооперация',branch:'economy',tier:4,cost:300,days:3,requires:['automation'],icon:'science',desc:'Выработка науки увеличивается на 40%.'}
];
export const DIFFICULTIES = {easy:{name:'Курсант',enemy:.7,start:2400},normal:{name:'Стратег',enemy:1,start:1900},hard:{name:'Командующий',enemy:1.3,start:1600}};
export const TAXES = {civil:{name:'Развитие',mult:.8,morale:1.6},balanced:{name:'Баланс',mult:1,morale:.3},war:{name:'Мобилизация',mult:1.3,morale:-1.7}};
const ownData = [
 ['aurora','Аврора',243,235,'Столица',2,1,1,1],['sever','Северск',300,100,'Энергетика',1,2,0,1],['vega','Вега',113,328,'Научный центр',1,1,2,1],['gorny','Горный',403,187,'Промышленность',3,0,0,1],['mirny','Мирный',352,399,'Промышленность',2,1,0,0],['port','Порт-Лазурь',179,467,'Торговый порт',1,1,1,1]
];
const foeData = [
 ['vesper','Веспер',741,270,'Столица'],['north','Норд',666,113,'Промышленность'],['argon','Аргон',868,160,'Энергетика'],['tarn','Тарн',567,344,'Военный узел'],['delta','Дельта',817,444,'Промышленность'],['raven','Равен',650,498,'Торговый порт']
];
export function createGame(difficulty='normal',seed=Date.now()) {
  if(!DIFFICULTIES[difficulty]) difficulty='normal';
  return {version:VERSION,seed:seed>>>0,day:1,difficulty,cash:DIFFICULTIES[difficulty].start+1000,metal:205,science:105,morale:85,ammo:48,tax:'balanced',units:{scout:10,bomber:0,cruise:0,ballistic:0},tech:[],research:null,queue:[],orders:[],placements:[],roads:[],nextId:1,status:'playing',stats:{intercepted:0,launched:0,damage:0,spent:0},cities:ownData.map(([id,name,x,y,role,industry,energy,lab,gun])=>({id,name,x,y,role,hp:100,buildings:{housing:3,commerce:1,park:1,industry,energy,lab,gun,shelter:0,sam:0,shield:0}})),enemies:foeData.map(([id,name,x,y,role],i)=>({id,name,x,y,role,hp:100,defense:i===0?2:1})),log:[{day:1,type:'good',text:'Командование принято. Все шесть городов на связи.'},{day:1,type:'info',text:'Разведка: первый налёт ожидается в конце второго дня.'}],history:[],lastReport:null,event:null};
}
export function rand(s){s.seed=(Math.imul(1664525,s.seed)+1013904223)>>>0;return s.seed/4294967296;}
export function addLog(s,text,type='info'){s.log.unshift({day:s.day,text,type});s.log=s.log.slice(0,90);}
export function economics(s){
 let income=0,metal=0,science=0,capacity=15,demand=6,upkeep=0;
 for(const c of s.cities){const h=c.hp/100,b=c.buildings;income+=(25+b.industry*42*(s.tech.includes('automation')?1.25:1)+(b.housing||0)*14+(b.commerce||0)*38+(c.id==='port'?35:0))*h;metal+=(1+b.industry*4)*h;science+=(1+b.lab*5)*h;capacity+=b.energy*12*h;demand+=b.industry*2+b.lab*3+b.gun+b.sam*2+b.shield*3+(b.housing||0)+(b.commerce||0)*2;upkeep+=b.gun*12+b.sam*22+b.shield*32+b.shelter*3+(b.park||0)*3;}
 if(s.tech.includes('grid'))capacity*=1.3;
 const power=Math.min(1,capacity/Math.max(1,demand));
 income*=TAXES[s.tax].mult*power*(.7+s.morale*.003);metal*=power*(s.tech.includes('logistics')?1.2:1);science*=power*(s.tech.includes('science')?1.4:1);upkeep*=s.tech.includes('efficiency')?.8:1;
 return {income:Math.round(income),upkeep:Math.round(upkeep),net:Math.round(income-upkeep),metal:Math.round(metal),science:Math.round(science),capacity:Math.round(capacity),demand:Math.round(demand),power};
}
export function integrity(s){return Math.round(s.cities.reduce((a,c)=>a+c.hp,0)/6);}
export function enemyPower(s){return Math.round(s.enemies.reduce((a,c)=>a+c.hp,0)/6);}
export function queueLimit(s){return s.tech.includes('logistics')?5:4;}
export function population(s){return Math.round(s.cities.reduce((a,c)=>a+(1400+(c.buildings.housing||0)*240)*c.hp/100,0));}
export function placeBuilding(s,cityId,key,x,z){
 if(!Number.isFinite(x)||!Number.isFinite(z)||Math.abs(x)>3000||Math.abs(z)>3000)return 'Здесь строить нельзя.';
 if((s.placements||[]).some(p=>Math.hypot(p.x-x,p.z-z)<22)||s.queue.some(q=>q.position&&Math.hypot(q.position.x-x,q.position.z-z)<22))return 'Участок уже занят.';
 const error=build(s,cityId,key);if(error)return error;s.queue.at(-1).position={x,z};return null;
}
export function addRoad(s,a,b){
 if(!allowed(s))return 'Сейчас строительство недоступно.';
 if(![a.x,a.z,b.x,b.z].every(n=>Number.isFinite(n)&&Math.abs(n)<3000))return 'За пределами территории.';
 const length=Math.hypot(a.x-b.x,a.z-b.z);if(length<12)return 'Выберите конец дороги дальше от начала.';if(length>700)return 'Стройте дорогу участками до 700 ед.';
 const cost=Math.round(length*.7);if(s.cash<cost)return `Для дороги нужно ${cost} ¤.`;s.cash-=cost;s.stats.spent+=cost;s.roads??=[];s.roads.push({id:s.nextId++,a,b});addLog(s,`Проложена дорога: ${Math.round(length)} ед., ${cost} ¤.`);return null;
}
export function demolish(s,id){
 if(!allowed(s))return 'Сейчас снос недоступен.';const i=(s.placements||[]).findIndex(p=>p.id===id);if(i<0)return 'Снос доступен для построенных вами объектов.';if(s.cash<25)return 'Для сноса нужно 25 ¤.';
 const p=s.placements.splice(i,1)[0],c=s.cities.find(c=>c.id===p.cityId);c.buildings[p.key]=Math.max(0,c.buildings[p.key]-1);s.cash-=25;addLog(s,`${c.name}: объект снесён.`);return null;
}
export function coverage(s,c,type='scout'){
 const b=c.buildings;let chance=.03;
 if(type==='ballistic')chance+=b.shield*.4+b.sam*.055;
 else {chance+=b.gun*(type==='cruise'?.055:.18)+b.sam*.25+b.shield*.1;for(const other of s.cities){if(other.id!==c.id&&other.hp>0&&Math.hypot(other.x-c.x,other.y-c.y)<210)chance+=other.buildings.sam*.035;}}
 chance+=s.tech.includes('radar')?.08:0;chance+=s.tech.includes('efficiency')?.06:0;
 if(c.hp<=0)return 0;
 return Math.min(.9,chance*(s.ammo>0?1:.15)*(s.cash>0?1:.65));
}
function allowed(s){return s.status==='playing'&&!s.event;}
export function build(s,cityId,key){
 if(!allowed(s))return 'Завершите текущее событие.';
 const c=s.cities.find(c=>c.id===cityId),b=BUILDINGS[key];if(!c||!b)return 'Объект не найден.';
 if(c.hp<=0&&key!=='repair')return 'Сначала восстановите город.';
 if(b.tech&&!s.tech.includes(b.tech))return 'Сначала завершите соответствующее исследование.';
 if(c.buildings[key]+s.queue.filter(q=>q.type==='build'&&q.cityId===cityId&&q.key===key).length>=b.max)return 'Максимальный уровень уже достигнут или заказан.';
 if(s.queue.length>=queueLimit(s))return 'Производственная очередь заполнена.';
 if(s.cash<b.cost||s.metal<b.metal)return 'Недостаточно денег или сплавов.';
 s.cash-=b.cost;s.metal-=b.metal;s.stats.spent+=b.cost;s.queue.push({id:s.nextId++,type:'build',cityId,key,left:b.days,total:b.days,cost:b.cost,metal:b.metal});addLog(s,`${c.name}: строительство — ${b.short.toLowerCase()}.`);return null;
}
export function repair(s,cityId){
 if(!allowed(s))return 'Завершите текущее событие.';
 const c=s.cities.find(c=>c.id===cityId);if(!c)return 'Город не найден.';if(c.hp>=100)return 'Город не повреждён.';
 if(s.queue.some(q=>q.type==='repair'&&q.cityId===cityId))return 'Восстановление уже идёт.';
 if(s.queue.length>=queueLimit(s))return 'Производственная очередь заполнена.';if(s.cash<140||s.metal<10)return 'Нужно 140 ¤ и 10 сплавов.';
 s.cash-=140;s.metal-=10;s.stats.spent+=140;s.queue.push({id:s.nextId++,type:'repair',cityId,left:1,total:1,cost:140,metal:10});return null;
}
export function produce(s,key,quantity){
 if(!allowed(s))return 'Завершите текущее событие.';
 const u=UNITS[key];if(!u)return 'Неизвестная система.';quantity=Number(quantity);if(!Number.isInteger(quantity)||quantity<1||quantity>20)return 'Выберите от 1 до 20 единиц.';
 if(u.tech&&!s.tech.includes(u.tech))return 'Технология ещё не исследована.';if(s.queue.length>=queueLimit(s))return 'Производственная очередь заполнена.';
 if(s.cash<u.cost*quantity||s.metal<u.metal*quantity)return 'Недостаточно денег или сплавов.';
 if(!s.cities.some(c=>c.hp>0&&c.buildings.industry>0))return 'Нет работающих промышленных комплексов.';
 s.cash-=u.cost*quantity;s.metal-=u.metal*quantity;s.stats.spent+=u.cost*quantity;s.queue.push({id:s.nextId++,type:'unit',key,quantity,left:u.days,total:u.days,cost:u.cost*quantity,metal:u.metal*quantity});addLog(s,`Производство: ${u.name} ×${quantity}.`);return null;
}
export function buyAmmo(s){
 if(!allowed(s))return 'Завершите текущее событие.';if(s.cash<130||s.metal<8)return 'Нужно 130 ¤ и 8 сплавов.';if(s.ammo>=180)return 'Склад перехватчиков заполнен.';
 s.cash-=130;s.metal-=8;s.stats.spent+=130;s.ammo=Math.min(200,s.ammo+20);addLog(s,'Запас перехватчиков пополнен: +20.','good');return null;
}
export function research(s,id){
 if(!allowed(s))return 'Завершите текущее событие.';const t=TECHS.find(t=>t.id===id);if(!t)return 'Неизвестная технология.';if(s.research)return 'Уже идёт другое исследование.';if(s.tech.includes(id))return 'Технология уже изучена.';
 if(t.requires.some(r=>!s.tech.includes(r)))return 'Сначала изучите предыдущую технологию.';if(s.science<t.cost)return 'Недостаточно науки.';
 s.science-=t.cost;s.research={id,left:t.days,total:t.days};addLog(s,`Начато исследование «${t.name}».`);return null;
}
export function raid(s,targetId,composition){
 if(!allowed(s))return 'Завершите текущее событие.';const target=s.enemies.find(c=>c.id===targetId);if(!target||target.hp<=0)return 'Выберите действующий объект противника.';
 if(s.orders.length>=3)return 'На день доступно не более трёх операций.';let total=0;
 for(const k of Object.keys(UNITS)){const n=Number(composition[k]||0);if(!Number.isInteger(n)||n<0||n>s.units[k])return 'Недопустимый состав группы.';total+=n;}
 if(total<1||total>30)return 'Выберите от 1 до 30 единиц.';
 const units={};for(const k of Object.keys(UNITS)){units[k]=Number(composition[k]||0);s.units[k]-=units[k];}
 s.orders.push({id:s.nextId++,targetId,units});addLog(s,`Подготовлена операция: ${target.name}, ${total} ед.`);return null;
}
export function cancel(s,id){
 if(!allowed(s))return 'Завершите текущее событие.';const i=s.queue.findIndex(q=>q.id===id);if(i<0)return 'Заказ не найден.';const [q]=s.queue.splice(i,1);s.cash+=Math.floor(q.cost*.75);s.metal+=Math.floor(q.metal*.75);addLog(s,'Заказ отменён. Возвращено 75% ресурсов.');return null;
}
export function cancelRaid(s,id){if(!allowed(s))return 'Завершите текущее событие.';const i=s.orders.findIndex(o=>o.id===id);if(i<0)return 'Операция не найдена.';const [o]=s.orders.splice(i,1);for(const k of Object.keys(UNITS))s.units[k]+=o.units[k];return null;}
export function setTax(s,key){if(!allowed(s))return 'Завершите текущее событие.';if(!TAXES[key])return 'Неизвестный режим.';s.tax=key;return null;}
export function resolveEvent(s,index){
 if(!s.event||!Number.isInteger(index)||!s.event.choices[index])return 'Выберите вариант.';
 const c=s.event.choices[index];if(c.cost&&s.cash<c.cost)return 'Недостаточно денег для этого решения.';
 s.cash+=c.cash||0;s.cash-=c.cost||0;s.metal+=c.metal||0;s.science+=c.science||0;s.morale=Math.min(100,Math.max(0,s.morale+(c.morale||0)));addLog(s,`${s.event.title}: ${c.label}.`,'info');s.event=null;checkEnd(s);return null;
}
const EVENTS=[
 {title:'Помощь союзников',desc:'Торговая лига предлагает помощь. Выберите груз, который важнее для вашей стратегии.',choices:[{label:'Финансовая поддержка',detail:'+450 ¤',cash:450},{label:'Промышленный груз',detail:'+65 сплавов',metal:65},{label:'Научная миссия',detail:'+90 науки',science:90}]},
 {title:'Обращение граждан',desc:'Люди просят направить часть бюджета на социальную поддержку. Решение повлияет на доверие.',choices:[{label:'Программа поддержки',detail:'−300 ¤ · +12 доверия',cost:300,morale:12},{label:'Обратиться к населению',detail:'+3 доверия',morale:3}]},
 {title:'Окно возможностей',desc:'Инженеры нашли способ ускорить развитие. Выберите направление разовой программы.',choices:[{label:'Грант инженерам',detail:'−250 ¤ · +120 науки',cost:250,science:120},{label:'Переработка материалов',detail:'+35 сплавов',metal:35}]}
];
function checkEnd(s){
 if(s.cities[0].hp<=0||s.morale<=0||s.cities.every(c=>c.hp<=0)){s.status='defeat';s.event=null;return;}
 if(enemyPower(s)<=20){s.status='victory';s.event=null;return;}
 if(s.day>60){s.status=integrity(s)>=50&&s.morale>=25?'victory':'defeat';s.event=null;}
}
export function nextDay(s){
 if(!allowed(s))return {error:s.status!=='playing'?'Кампания завершена.':'Сначала примите решение по событию.'};
 const eco=economics(s),report={day:s.day,income:eco.net,metal:eco.metal,science:eco.science,intercepted:0,incoming:0,damage:0,dealt:0,completed:[],flights:[]};
 s.cash+=eco.net;s.metal+=eco.metal;s.science+=eco.science;s.morale=Math.min(100,s.morale+TAXES[s.tax].morale+(integrity(s)>75?.3:0)+Math.min(1.5,s.cities.reduce((a,c)=>a+(c.buildings.park||0)*c.hp/100,0)*.1));
 if(s.cash<0){s.cash=0;s.morale-=5;addLog(s,'Дефицит бюджета: доверие −5. Сократите расходы.','bad');}
 if(eco.power<1){s.morale-=1;addLog(s,`Дефицит энергии: производство работает на ${Math.round(eco.power*100)}%.`,'bad');}
 for(const q of s.queue)q.left--;
 for(const q of s.queue.filter(q=>q.left<=0)){
   if(q.type==='unit'){s.units[q.key]+=q.quantity;report.completed.push(`${UNITS[q.key].name} ×${q.quantity}`);}
   else {const c=s.cities.find(c=>c.id===q.cityId);if(q.type==='repair'){c.hp=Math.min(100,c.hp+40);report.completed.push(`${c.name}: восстановление +40`);}else {c.buildings[q.key]++;if(q.position){s.placements??=[];s.placements.push({id:q.id,cityId:q.cityId,key:q.key,x:q.position.x,z:q.position.z});}report.completed.push(`${c.name}: ${BUILDINGS[q.key].short}`);}}
 }
 s.queue=s.queue.filter(q=>q.left>0);
 if(s.research&&--s.research.left<=0){const t=TECHS.find(t=>t.id===s.research.id);s.tech.push(t.id);report.completed.push(t.name);if(t.id==='resilience')s.morale=Math.min(100,s.morale+10);s.research=null;}
 for(const o of s.orders){
   const c=s.enemies.find(c=>c.id===o.targetId);if(!c||c.hp<=0){for(const k of Object.keys(UNITS))s.units[k]+=o.units[k];addLog(s,'Группа вернулась: цель уже выведена из строя.');continue;}
   let hits=0,damage=0,total=0;
   for(const [key,n] of Object.entries(o.units))for(let i=0;i<n;i++){
     total++;const evade=key==='ballistic'?.1:key==='cruise'?.19:.32;const chance=Math.min(.7,evade*c.defense*(.85+s.day*.006));
     if(rand(s)>chance){hits++;damage+=UNITS[key].damage*(s.tech.includes('guidance')?1.2:1)*(.8+rand(s)*.4);}
   }
   const actual=Math.min(c.hp,Math.round(damage));c.hp=Math.max(0,c.hp-actual);report.dealt+=actual;s.stats.launched+=total;report.flights.push({from:'aurora',to:c.id,side:'own',count:total,hits,damage:actual,units:{...o.units}});
   addLog(s,`${c.name}: достигли цели ${hits}/${total}, урон ${actual}%.${c.hp<=0?' Объект выведен из строя.':''}`,actual?'good':'bad');
 }
 s.orders=[];
 if(s.day>=2&&enemyPower(s)>20){
   const pressure=DIFFICULTIES[s.difficulty].enemy*(.5+enemyPower(s)/200);
   const waves=s.day>=15?2:1;
   for(let wave=0;wave<waves;wave++){
     const live=s.cities.filter(c=>c.hp>0);if(!live.length)break;
     const c=rand(s)<.28?s.cities[0]:live[Math.floor(rand(s)*live.length)];if(c.hp<=0)continue;
     const key=s.day>=22&&rand(s)<.2?'ballistic':s.day>=13&&rand(s)<.3?'cruise':s.day>=7&&rand(s)<.4?'bomber':'scout';
     const total=Math.max(1,Math.round((2+s.day*.17)*pressure*(key==='ballistic'?.35:key==='cruise'?.5:1)));let stopped=0,damage=0;
     const source=s.enemies.filter(c=>c.hp>0)[Math.floor(rand(s)*s.enemies.filter(c=>c.hp>0).length)];
     for(let i=0;i<total;i++){
       const chance=coverage(s,c,key),canShoot=s.ammo>0;if(canShoot)s.ammo--;if(canShoot&&rand(s)<chance){stopped++;continue;}
       damage+=UNITS[key].damage*.68*(.8+rand(s)*.4)*Math.max(.5,1-c.buildings.shelter*.12)*(s.tech.includes('resilience')?.85:1);
     }
     const actual=Math.min(c.hp,Math.round(damage));c.hp=Math.max(0,c.hp-actual);s.morale-=actual*.035+(c.hp<=0?5:0);report.intercepted+=stopped;report.incoming+=total;report.damage+=actual;
     report.flights.push({from:source.id,to:c.id,side:'enemy',count:total,hits:total-stopped,damage:actual,key});addLog(s,`${c.name}: налёт ${total} ед., перехвачено ${stopped}, ущерб ${actual}%.`,actual>15?'bad':'info');
   }
 }
 for(const c of s.enemies){if(c.hp>0&&c.hp<100)c.hp=Math.min(100,c.hp+(s.day%3===0?5:2));if(s.day%14===0&&c.hp>0)c.defense=Math.min(2.3,c.defense+.15);}
 report.completed.forEach(t=>addLog(s,`Завершено: ${t}.`,'good'));
 s.stats.intercepted+=report.intercepted;s.stats.damage+=report.dealt;s.morale=Math.max(0,Math.round(s.morale*10)/10);s.cash=Math.round(s.cash);s.metal=Math.round(s.metal);s.science=Math.round(s.science);s.lastReport=report;
 s.history.push({day:s.day,cash:s.cash,net:eco.net,integrity:integrity(s),power:enemyPower(s),morale:s.morale});s.history=s.history.slice(-60);s.day++;checkEnd(s);
 if(s.status==='playing'&&s.day>=6&&(s.day-6)%7===0)s.event=structuredClone(EVENTS[Math.floor((s.day-6)/7)%EVENTS.length]);
 return report;
}
export function validateSave(v){
 if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Некорректный файл кампании.');
 v.placements??=[];v.roads??=[];
 if(!v||v.version!==VERSION||!DIFFICULTIES[v.difficulty]||!TAXES[v.tax]||!['playing','victory','defeat'].includes(v.status))throw Error('Формат сохранения не поддерживается.');
 const nonneg=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
 if(!Number.isInteger(v.day)||v.day<1||v.day>61||!['cash','metal','science','morale','ammo','seed','nextId'].every(k=>nonneg(v[k]))||v.morale>100||v.ammo>200)throw Error('Некорректные ресурсы в сохранении.');
 if(!Array.isArray(v.cities)||v.cities.length!==6||!Array.isArray(v.enemies)||v.enemies.length!==6)throw Error('Некорректная карта.');
 for(let i=0;i<6;i++){
  const c=v.cities[i],e=v.enemies[i];if(c.id!==ownData[i][0]||e.id!==foeData[i][0]||![c.hp,e.hp].every(n=>nonneg(n)&&n<=100)||!nonneg(e.defense))throw Error('Некорректное состояние городов.');
  if(c.buildings){c.buildings.housing??=3;c.buildings.commerce??=1;c.buildings.park??=1;}
  if(!c.buildings||!Object.keys(BUILDINGS).every(k=>Number.isInteger(c.buildings[k])&&c.buildings[k]>=0&&c.buildings[k]<=BUILDINGS[k].max))throw Error('Некорректные здания.');
 }
 if(!v.units||!Object.keys(UNITS).every(k=>Number.isInteger(v.units[k])&&v.units[k]>=0)||!Array.isArray(v.tech)||v.tech.some(t=>!TECHS.some(x=>x.id===t))||new Set(v.tech).size!==v.tech.length)throw Error('Некорректные технологии или арсенал.');
 if(!Array.isArray(v.queue)||v.queue.length>5||!Array.isArray(v.orders)||v.orders.length>3||!Array.isArray(v.log)||!Array.isArray(v.history)||!v.stats)throw Error('Некорректные очереди.');
 const point=p=>p&&['x','z'].every(k=>typeof p[k]==='number'&&Number.isFinite(p[k])&&Math.abs(p[k])<=3000),city=id=>v.cities.some(c=>c.id===id);
 if(!Array.isArray(v.placements)||v.placements.length>500||v.placements.some(p=>!p||!Number.isInteger(p.id)||!city(p.cityId)||!BUILDINGS[p.key]||!point(p)))throw Error('Некорректные участки строительства.');
 if(!Array.isArray(v.roads)||v.roads.length>500||v.roads.some(r=>!r||!Number.isInteger(r.id)||!point(r.a)||!point(r.b)))throw Error('Некорректные дороги.');
 for(const q of v.queue){if(!q||!Number.isInteger(q.id)||!['build','unit','repair'].includes(q.type)||!Number.isInteger(q.left)||q.left<1||!Number.isInteger(q.total)||q.left>q.total||q.total>10||!nonneg(q.cost)||!nonneg(q.metal)||(q.type==='build'&&!BUILDINGS[q.key])||(q.type==='unit'&&(!UNITS[q.key]||!Number.isInteger(q.quantity)||q.quantity<1||q.quantity>20))||(q.type!=='unit'&&!v.cities.some(c=>c.id===q.cityId))||(q.position&&!point(q.position)))throw Error('Повреждён заказ.');}
 for(const o of v.orders){if(!v.enemies.some(c=>c.id===o.targetId)||!o.units||!Object.keys(UNITS).every(k=>Number.isInteger(o.units[k])&&o.units[k]>=0&&o.units[k]<=30))throw Error('Повреждена операция.');}
 if(v.research&&(!TECHS.some(t=>t.id===v.research.id)||!Number.isInteger(v.research.left)||v.research.left<1||!Number.isInteger(v.research.total)||v.research.left>v.research.total||v.research.total>10))throw Error('Повреждено исследование.');
 if(!['intercepted','launched','damage','spent'].every(k=>nonneg(v.stats[k])))throw Error('Некорректная статистика.');
 if(v.history.length>60||v.history.some(h=>!h||!['day','cash','integrity','power','morale'].every(k=>nonneg(h[k]))||!Number.isFinite(h.net)))throw Error('Некорректная экономическая история.');
 if(v.log.length>100||v.log.some(l=>!l||typeof l.text!=='string'||l.text.length>1000||!nonneg(l.day)||!['info','good','bad'].includes(l.type)))throw Error('Некорректный журнал.');
 if(v.lastReport){const r=v.lastReport;if(!['day','metal','science','intercepted','incoming','damage','dealt'].every(k=>nonneg(r[k]))||!Number.isFinite(r.income)||!Array.isArray(r.completed)||r.completed.some(t=>typeof t!=='string'||t.length>200)||!Array.isArray(r.flights)||r.flights.length>10)throw Error('Некорректный отчёт.');for(const f of r.flights){if(!f||![...v.cities,...v.enemies].some(c=>c.id===f.from)||![...v.cities,...v.enemies].some(c=>c.id===f.to)||!['own','enemy'].includes(f.side)||!Number.isInteger(f.count)||f.count<0||f.count>100||!Number.isInteger(f.hits)||f.hits<0||f.hits>f.count||!nonneg(f.damage)||(f.key&&!UNITS[f.key])||(f.units&&!Object.keys(UNITS).every(k=>Number.isInteger(f.units[k])&&f.units[k]>=0&&f.units[k]<=30)))throw Error('Некорректные данные полёта.');}}
 if(v.event){const valid=EVENTS.find(e=>e.title===v.event.title);if(!valid)throw Error('Неизвестное событие.');v.event=structuredClone(valid);}
 for(let i=0;i<6;i++){Object.assign(v.cities[i],{name:ownData[i][1],x:ownData[i][2],y:ownData[i][3],role:ownData[i][4]});Object.assign(v.enemies[i],{name:foeData[i][1],x:foeData[i][2],y:foeData[i][3],role:foeData[i][4]});}
 return v;
}
