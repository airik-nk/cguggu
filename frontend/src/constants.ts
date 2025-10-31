export const DEPARTMENTS = [
  '教務處',
  '學務處',
  '總務處',
  '輔導室',
  '圖書館',
  '人事室',
  '主計室'
] as const;

export type Department = typeof DEPARTMENTS[number];

export interface FileWithDepartment extends File {
  department?: Department;
}