'use client'

import ToggleSwitch from '@/components/ToggleSwitch'
import SettingRow from '../SettingRow'
import styles from './SettingEmailRulesRow.module.css'
import { bindClassNames } from '@/lib/styles/bindClassNames'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useUpdateEmailRulesMutation } from '@/graphql/helpers/generated'

const cx = bindClassNames(styles)

type Props = {
  notification: boolean
  promotion: boolean
}

function SettingEmailRulesRow({ notification, promotion }: Props) {
  const mounted = useRef<boolean>(false)
  const [values, setValues] = useState({ promotion, notification })
  const { mutate } = useUpdateEmailRulesMutation()

  const onChange = useCallback(({ name, value }: { name: string; value: boolean }) => {
    setValues((prev) => ({ ...prev, [name]: value }))
  }, [])

  useEffect(() => {
    mounted.current = true
    mutate({ input: values })
  }, [values, mutate])

  return (
    <SettingRow title="이메일 수신 설정" className={cx('block')}>
      <ul className={cx('rules')}>
        <li>
          <span>댓글 알림</span>
          <ToggleSwitch
            className={cx('toggle')}
            value={values.notification}
            name="notification"
            onChange={onChange}
          />
        </li>
        <li>
          <span>벨로그 업데이트 소식</span>
          <ToggleSwitch
            className={cx('toggle')}
            value={values.promotion}
            name="promotion"
            onChange={onChange}
          />
        </li>
      </ul>
    </SettingRow>
  )
}

export default SettingEmailRulesRow
