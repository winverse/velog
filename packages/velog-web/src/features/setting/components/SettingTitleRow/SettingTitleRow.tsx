'use client'

import useInput from '@/hooks/useInput'
import styles from './SettingTitleRow.module.css'
import { bindClassNames } from '@/lib/styles/bindClassNames'
import { useState } from 'react'
import SettingRow from '../SettingRow'
import SettingInput from '../SettingInput'
import Button from '@/components/Button'

const cx = bindClassNames(styles)

type Props = {
  title: string
  onUpdateTitle: (title: string) => Promise<any>
}

function SettingTitleRow({ title, onUpdateTitle }: Props) {
  const [edit, setEdit] = useState(false)
  const [value, onChange] = useInput(title)
  const onSubmit = async (e: React.FormEvent) => {}

  return (
    <SettingRow
      title="벨로그 제목"
      description="개인 페이지의 좌측 상단에 나타나는 페이지 제목입니다."
      editButton={!edit}
      onClickEdit={() => setEdit(true)}
    >
      {edit ? (
        <form className={cx('form')} onSubmit={onSubmit}>
          <SettingInput value={value} onChange={onChange} placeholder="벨로그 제목" />
          <Button>저장</Button>
        </form>
      ) : (
        title
      )}
    </SettingRow>
  )
}

export default SettingTitleRow
