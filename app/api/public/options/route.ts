import { ensureSchema, getDatabase } from "@/lib/database";
import { json } from "@/lib/responses";

type EmployeeOption = {
  employee_number: string;
  department: string;
  unit: string;
};

export async function GET() {
  await ensureSchema();
  const db = getDatabase();
  const [settings, employees] = await Promise.all([
    db.prepare("SELECT title, status FROM election_settings WHERE id = 1").first<{ title: string; status: string }>(),
    db.prepare(
      "SELECT employee_number, department, unit FROM employees ORDER BY department, unit, employee_number",
    ).all<EmployeeOption>(),
  ]);

  const departments = new Map<string, Map<string, string[]>>();
  for (const employee of employees.results ?? []) {
    if (!departments.has(employee.department)) departments.set(employee.department, new Map());
    const units = departments.get(employee.department)!;
    if (!units.has(employee.unit)) units.set(employee.unit, []);
    units.get(employee.unit)!.push(employee.employee_number);
  }

  return json({
    election: settings ?? { title: "福委改選", status: "setup" },
    departments: Array.from(departments, ([name, units]) => ({
      name,
      units: Array.from(units, ([unitName, employeeNumbers]) => ({
        name: unitName,
        employeeNumbers,
      })),
    })),
  });
}
