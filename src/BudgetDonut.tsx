import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'

type BudgetDonutProps = {
  chartData: { name: string; value: number; color: string }[]
  innerRadius: string
  outerRadius: string
  formatAmount: (value: number) => string
}

export default function BudgetDonut({ chartData, innerRadius, outerRadius, formatAmount }: BudgetDonutProps) {
  return <ResponsiveContainer width="100%" height="100%">
    <PieChart>
      <Pie data={chartData} dataKey="value" nameKey="name" innerRadius={innerRadius} outerRadius={outerRadius} paddingAngle={3} stroke="none">
        {chartData.map((row) => <Cell key={row.name} fill={row.color} />)}
      </Pie>
      <Tooltip formatter={(value) => formatAmount(Number(value))} contentStyle={{ borderRadius: 12, border: '1px solid #e2d5c7', fontSize: 12 }} />
    </PieChart>
  </ResponsiveContainer>
}
