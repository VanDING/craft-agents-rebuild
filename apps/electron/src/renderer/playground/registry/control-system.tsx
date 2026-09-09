import * as React from 'react'
import { Settings, MoreHorizontal } from 'lucide-react'
import type { ComponentEntry } from './types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { HeaderIconButton } from '@/components/ui/HeaderIconButton'
import { TopBarButton } from '@/components/ui/TopBarButton'
import { SettingsInput, SettingsInputRow, SettingsSecretInput } from '@/components/settings/SettingsInput'
import { SettingsTextarea } from '@/components/settings/SettingsTextarea'
import { SettingsSelect } from '@/components/settings/SettingsSelect'
import { SettingsToggle } from '@/components/settings/SettingsToggle'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsRow } from '@/components/settings/SettingsRow'
import { SettingsSegmentedControl } from '@/components/settings/SettingsSegmentedControl'
import { SettingsRadioGroup, SettingsRadioCard } from '@/components/settings/SettingsRadioGroup'
import { SettingsMenuSelect } from '@/components/settings/SettingsMenuSelect'
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { EntityRow } from '@/components/ui/entity-row'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'

// Real production controls, synthetic values only. Also used by the focused browser check.
function ControlSystemSample({ count = 0 }: { count?: number }) {
  const [name, setName] = React.useState('研究工作区 Research workspace')
  const [secret, setSecret] = React.useState('sample-token-not-a-credential')
  const [notes, setNotes] = React.useState('按项目整理资料，保留原文链接。')
  const [mode, setMode] = React.useState('balanced')
  const [enabled, setEnabled] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [selected, setSelected] = React.useState(0)
  const options = [{ value: 'balanced', label: '均衡 Balanced' }, { value: 'fast', label: '快速 Fast' }, { value: 'careful', label: '深入分析 Careful analysis' }]
  if (count) return <div data-testid="control-list" className="h-full overflow-auto">
    {Array.from({ length: count }, (_, i) => <EntityRow key={i} title={`资料整理 ${i + 1}`} subtitle="Research notes · synthetic data" isSelected={selected === i} onClick={() => setSelected(i)} menuContent={<DropdownMenuItem>查看详情</DropdownMenuItem>} />)}
  </div>
  return <div data-testid="control-system" className="w-full min-w-0 space-y-6 p-5">
    <div className="flex items-center justify-between gap-2">
      <div><h2 className="text-lg font-semibold">工作区设置</h2><p className="text-sm text-muted-foreground">组件状态与键盘交互样板 · 合成数据</p></div>
      <div className="flex gap-1"><HeaderIconButton icon={<Settings className="size-4" />} tooltip="面板设置" aria-label="面板设置" /><TopBarButton aria-label="更多操作"><MoreHorizontal className="size-4" /></TopBarButton></div>
    </div>
    <SettingsCard>
      <SettingsInput label="工作区名称" description="长说明在窄面板中换行，帮助文字需要保持可读。" value={name} onChange={setName} inCard />
      <SettingsSecretInput label="访问密钥" description="仅供组件验证的合成字符串。" value={secret} onChange={setSecret} inCard />
      <SettingsInputRow label="服务地址" description="失败时保留输入，便于修正。" value="https://example.invalid" onChange={() => {}} error="连接失败，请检查服务地址。" />
      <SettingsSelect label="默认模式" options={options} value={mode} onValueChange={setMode} inCard />
      <SettingsToggle label="完成通知" description="任务结束后显示通知。" checked={enabled} onCheckedChange={setEnabled} />
      <SettingsTextarea label="工作区说明" value={notes} onChange={setNotes} maxLength={200} inCard />
    </SettingsCard>
    <SettingsRow label="显示模式" description="使用方向键切换选项。" inCard={false}><SettingsSegmentedControl value={mode} onValueChange={setMode} options={options} /></SettingsRow>
    <SettingsRadioGroup value={mode} onValueChange={setMode}>
      {options.map(option => <SettingsRadioCard key={option.value} {...option} description="保留现有选择行为" />)}
    </SettingsRadioGroup>
    <SettingsMenuSelect value={mode} onValueChange={setMode} options={options} searchable />
    <div className="flex flex-wrap items-center gap-2" data-testid="button-states">
      <Button loading={saving} onClick={() => setSaving(true)}>保存设置</Button><Button variant="ghost" onClick={() => setSaving(false)}>重置加载</Button><Button variant="secondary">预览</Button><Button variant="outline">导出</Button><Button variant="ghost">取消</Button><Button variant="destructive">删除</Button><Button disabled>不可用</Button>
      <Dialog><DialogTrigger asChild><Button variant="outline">打开对话框</Button></DialogTrigger>
        <DialogContent><DialogHeader><DialogTitle>连接设置</DialogTitle><DialogDescription>验证嵌套选择器和关闭后的焦点恢复。</DialogDescription></DialogHeader>
          <SettingsSelect label="对话框内模式" options={options} value={mode} onValueChange={setMode} />
          <Input aria-label="对话框内输入" placeholder="输入内容" />
        </DialogContent>
      </Dialog>
    </div>
    <div className="space-y-2"><Input aria-label="只读值" value="只读内容仍可选择和复制" readOnly /><Input aria-label="不可用字段" value="不可用" disabled /><SettingsInput id="custom-field" aria-describedby="external-help" label="外部描述" description="字段内说明" value="" onChange={() => {}} /><p id="external-help">字段外说明</p></div>
    <EntityRow title="当前研究任务" titleTrailing={<span className="text-xs">12:30</span>} subtitle="键盘聚焦时也能发现更多操作" isSelected onClick={() => {}} menuContent={<DropdownMenuItem>查看详情</DropdownMenuItem>} />
  </div>
}

export const controlSystemComponents: ComponentEntry[] = [{
  id: 'control-system', name: 'Control System', category: 'Settings',
  description: 'Production controls: field states, nested overlays, keyboard navigation and list scale.',
  component: ControlSystemSample, props: [], layout: 'top',
  variants: [{ name: 'Settings', props: { count: 0 } }, { name: '100 rows', props: { count: 100 } }, { name: '1000 rows', props: { count: 1000 } }],
}]
