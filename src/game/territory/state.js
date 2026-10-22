import { DISTRICTS } from './districts.config.js';

const fields = ['id', 'owner', 'control', 'capturing', 'contested', 'blocked', 'hp', 'repairing'];
export const districtState = (value) => Object.fromEntries(fields.map((key) => [key, value[key]]));
export const createDistricts = () =>
  DISTRICTS.map((d) => ({
    id: d.id,
    owner: null,
    control: 0,
    capturing: null,
    contested: false,
    blocked: false,
    hp: d.hp,
    repairing: false,
  }));
