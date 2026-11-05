-- Restrict premium financial reports and attendance to packages with the matching entitlement.
GRANT EXECUTE ON FUNCTION private.kasusaha_business_has_feature(uuid,text) TO authenticated;

ALTER POLICY finance_accounts_owner_delete ON public.finance_accounts USING (
  EXISTS (SELECT 1 FROM public.business_members m WHERE m.business_id=finance_accounts.business_id AND m.user_id=(SELECT auth.uid()) AND m.active AND m.role='owner')
  AND is_system=false AND private.kasusaha_business_has_feature(business_id,'full_finance')
);
ALTER POLICY finance_accounts_owner_insert ON public.finance_accounts WITH CHECK (
  EXISTS (SELECT 1 FROM public.business_members m WHERE m.business_id=finance_accounts.business_id AND m.user_id=(SELECT auth.uid()) AND m.active AND m.role='owner')
  AND private.kasusaha_business_license_is_verified(business_id)
  AND private.kasusaha_business_has_feature(business_id,'full_finance')
);
ALTER POLICY finance_accounts_owner_select ON public.finance_accounts USING (
  EXISTS (SELECT 1 FROM public.business_members m WHERE m.business_id=finance_accounts.business_id AND m.user_id=(SELECT auth.uid()) AND m.active AND m.role='owner')
  AND private.kasusaha_business_has_feature(business_id,'full_finance')
);
ALTER POLICY finance_accounts_owner_update ON public.finance_accounts
USING (
  EXISTS (SELECT 1 FROM public.business_members m WHERE m.business_id=finance_accounts.business_id AND m.user_id=(SELECT auth.uid()) AND m.active AND m.role='owner')
  AND private.kasusaha_business_has_feature(business_id,'full_finance')
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.business_members m WHERE m.business_id=finance_accounts.business_id AND m.user_id=(SELECT auth.uid()) AND m.active AND m.role='owner')
  AND private.kasusaha_business_license_is_verified(business_id)
  AND private.kasusaha_business_has_feature(business_id,'full_finance')
);

ALTER POLICY finance_journal_entries_owner_delete ON public.finance_journal_entries USING (
  status='draft'
  AND EXISTS (SELECT 1 FROM public.business_members m WHERE m.business_id=finance_journal_entries.business_id AND m.user_id=(SELECT auth.uid()) AND m.active AND m.role='owner')
  AND private.kasusaha_business_has_feature(business_id,'full_finance')
);
ALTER POLICY finance_journal_entries_owner_insert ON public.finance_journal_entries WITH CHECK (
  created_by=(SELECT auth.uid()) AND status='draft'
  AND EXISTS (SELECT 1 FROM public.business_members m WHERE m.business_id=finance_journal_entries.business_id AND m.user_id=(SELECT auth.uid()) AND m.active AND m.role='owner')
  AND private.kasusaha_business_license_is_verified(business_id)
  AND private.kasusaha_business_has_feature(business_id,'full_finance')
);
ALTER POLICY finance_journal_entries_owner_select ON public.finance_journal_entries USING (
  EXISTS (SELECT 1 FROM public.business_members m WHERE m.business_id=finance_journal_entries.business_id AND m.user_id=(SELECT auth.uid()) AND m.active AND m.role='owner')
  AND private.kasusaha_business_has_feature(business_id,'full_finance')
);
ALTER POLICY finance_journal_entries_owner_update ON public.finance_journal_entries
USING (
  status='draft'
  AND EXISTS (SELECT 1 FROM public.business_members m WHERE m.business_id=finance_journal_entries.business_id AND m.user_id=(SELECT auth.uid()) AND m.active AND m.role='owner')
  AND private.kasusaha_business_has_feature(business_id,'full_finance')
)
WITH CHECK (
  status='draft'
  AND EXISTS (SELECT 1 FROM public.business_members m WHERE m.business_id=finance_journal_entries.business_id AND m.user_id=(SELECT auth.uid()) AND m.active AND m.role='owner')
  AND private.kasusaha_business_license_is_verified(business_id)
  AND private.kasusaha_business_has_feature(business_id,'full_finance')
);

ALTER POLICY finance_journal_lines_owner_delete ON public.finance_journal_lines USING (
  EXISTS (SELECT 1 FROM public.business_members m WHERE m.business_id=finance_journal_lines.business_id AND m.user_id=(SELECT auth.uid()) AND m.active AND m.role='owner')
  AND EXISTS (SELECT 1 FROM public.finance_journal_entries e WHERE e.id=finance_journal_lines.entry_id AND e.business_id=finance_journal_lines.business_id AND e.status='draft')
  AND private.kasusaha_business_has_feature(business_id,'full_finance')
);
ALTER POLICY finance_journal_lines_owner_insert ON public.finance_journal_lines WITH CHECK (
  EXISTS (SELECT 1 FROM public.business_members m WHERE m.business_id=finance_journal_lines.business_id AND m.user_id=(SELECT auth.uid()) AND m.active AND m.role='owner')
  AND EXISTS (SELECT 1 FROM public.finance_journal_entries e WHERE e.id=finance_journal_lines.entry_id AND e.business_id=finance_journal_lines.business_id AND e.status='draft')
  AND private.kasusaha_business_license_is_verified(business_id)
  AND private.kasusaha_business_has_feature(business_id,'full_finance')
);
ALTER POLICY finance_journal_lines_owner_select ON public.finance_journal_lines USING (
  EXISTS (SELECT 1 FROM public.business_members m WHERE m.business_id=finance_journal_lines.business_id AND m.user_id=(SELECT auth.uid()) AND m.active AND m.role='owner')
  AND private.kasusaha_business_has_feature(business_id,'full_finance')
);
ALTER POLICY finance_journal_lines_owner_update ON public.finance_journal_lines
USING (
  EXISTS (SELECT 1 FROM public.business_members m WHERE m.business_id=finance_journal_lines.business_id AND m.user_id=(SELECT auth.uid()) AND m.active AND m.role='owner')
  AND EXISTS (SELECT 1 FROM public.finance_journal_entries e WHERE e.id=finance_journal_lines.entry_id AND e.business_id=finance_journal_lines.business_id AND e.status='draft')
  AND private.kasusaha_business_has_feature(business_id,'full_finance')
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.business_members m WHERE m.business_id=finance_journal_lines.business_id AND m.user_id=(SELECT auth.uid()) AND m.active AND m.role='owner')
  AND EXISTS (SELECT 1 FROM public.finance_journal_entries e WHERE e.id=finance_journal_lines.entry_id AND e.business_id=finance_journal_lines.business_id AND e.status='draft')
  AND private.kasusaha_business_has_feature(business_id,'full_finance')
);

ALTER POLICY finance_open_items_owner_all ON public.finance_open_items
USING (
  EXISTS (SELECT 1 FROM public.business_members m WHERE m.business_id=finance_open_items.business_id AND m.user_id=(SELECT auth.uid()) AND m.active AND m.role='owner')
  AND private.kasusaha_business_has_feature(business_id,'full_finance')
)
WITH CHECK (
  created_by=(SELECT auth.uid())
  AND EXISTS (SELECT 1 FROM public.business_members m WHERE m.business_id=finance_open_items.business_id AND m.user_id=(SELECT auth.uid()) AND m.active AND m.role='owner')
  AND private.kasusaha_business_license_is_verified(business_id)
  AND private.kasusaha_business_has_feature(business_id,'full_finance')
);
ALTER POLICY finance_parties_owner_all ON public.finance_parties
USING (
  EXISTS (SELECT 1 FROM public.business_members m WHERE m.business_id=finance_parties.business_id AND m.user_id=(SELECT auth.uid()) AND m.active AND m.role='owner')
  AND private.kasusaha_business_has_feature(business_id,'full_finance')
)
WITH CHECK (
  created_by=(SELECT auth.uid())
  AND EXISTS (SELECT 1 FROM public.business_members m WHERE m.business_id=finance_parties.business_id AND m.user_id=(SELECT auth.uid()) AND m.active AND m.role='owner')
  AND private.kasusaha_business_license_is_verified(business_id)
  AND private.kasusaha_business_has_feature(business_id,'full_finance')
);

ALTER POLICY financial_transactions_select_by_role ON public.financial_transactions USING (
  EXISTS (
    SELECT 1 FROM public.business_members m
    WHERE m.business_id=financial_transactions.business_id AND m.user_id=(SELECT auth.uid()) AND m.active
      AND (
        (m.role='owner' AND (
          private.kasusaha_business_has_feature(financial_transactions.business_id,'full_finance')
          OR (financial_transactions.transaction_type='income' AND financial_transactions.category='Penjualan')
        ))
        OR
        (m.role='employee' AND financial_transactions.created_by_role='employee'
          AND financial_transactions.transaction_type='income'
          AND (
            financial_transactions.created_by=(SELECT auth.uid())
            OR private.kasusaha_employee_same_identity_user(financial_transactions.business_id,financial_transactions.created_by)
          )
          AND private.kasusaha_employee_device_is_paid(financial_transactions.business_id)
        )
      )
  )
);
ALTER POLICY financial_transactions_insert_by_member ON public.financial_transactions WITH CHECK (
  created_by=(SELECT auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.business_members m
    WHERE m.business_id=financial_transactions.business_id AND m.user_id=(SELECT auth.uid()) AND m.active
      AND m.role=financial_transactions.created_by_role
      AND (
        (m.role='owner' AND (
          private.kasusaha_business_has_feature(financial_transactions.business_id,'full_finance')
          OR (financial_transactions.transaction_type='income' AND financial_transactions.category='Penjualan')
        ))
        OR (m.role='employee' AND financial_transactions.transaction_type='income'
          AND private.kasusaha_employee_device_is_paid(financial_transactions.business_id))
      )
  )
  AND private.kasusaha_business_license_is_verified(business_id)
);
ALTER POLICY financial_transactions_delete_owner_only ON public.financial_transactions USING (
  EXISTS (SELECT 1 FROM public.business_members m WHERE m.business_id=financial_transactions.business_id AND m.user_id=(SELECT auth.uid()) AND m.active AND m.role='owner')
  AND private.kasusaha_business_license_is_verified(business_id)
  AND (private.kasusaha_business_has_feature(business_id,'full_finance') OR (transaction_type='income' AND category='Penjualan'))
);
ALTER POLICY financial_transactions_update_owner_only ON public.financial_transactions
USING (
  EXISTS (SELECT 1 FROM public.business_members m WHERE m.business_id=financial_transactions.business_id AND m.user_id=(SELECT auth.uid()) AND m.active AND m.role='owner')
  AND private.kasusaha_business_license_is_verified(business_id)
  AND (private.kasusaha_business_has_feature(business_id,'full_finance') OR (transaction_type='income' AND category='Penjualan'))
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.business_members m WHERE m.business_id=financial_transactions.business_id AND m.user_id=(SELECT auth.uid()) AND m.active AND m.role='owner')
  AND private.kasusaha_business_license_is_verified(business_id)
  AND (private.kasusaha_business_has_feature(business_id,'full_finance') OR (transaction_type='income' AND category='Penjualan'))
);

ALTER POLICY business_attendance_insert_self_member ON public.business_attendance WITH CHECK (
  user_id=(SELECT auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.business_members m
    WHERE m.business_id=business_attendance.business_id AND m.user_id=(SELECT auth.uid()) AND m.active
      AND (m.role='owner' OR (m.role='employee' AND private.kasusaha_employee_device_is_paid(business_attendance.business_id)))
  )
  AND private.kasusaha_business_license_is_verified(business_id)
  AND private.kasusaha_business_has_feature(business_id,'attendance')
);
ALTER POLICY business_attendance_select_member_or_owner ON public.business_attendance USING (
  EXISTS (
    SELECT 1 FROM public.business_members m
    WHERE m.business_id=business_attendance.business_id AND m.user_id=(SELECT auth.uid()) AND m.active
      AND (
        m.role='owner'
        OR (m.role='employee'
          AND (business_attendance.user_id=(SELECT auth.uid()) OR private.kasusaha_employee_same_identity_user(business_attendance.business_id,business_attendance.user_id))
          AND private.kasusaha_employee_device_is_paid(business_attendance.business_id))
      )
  )
  AND private.kasusaha_business_has_feature(business_id,'attendance')
);
ALTER POLICY business_attendance_update_self_or_owner ON public.business_attendance
USING (
  private.kasusaha_business_license_is_verified(business_id)
  AND private.kasusaha_business_has_feature(business_id,'attendance')
  AND EXISTS (
    SELECT 1 FROM public.business_members m
    WHERE m.business_id=business_attendance.business_id AND m.user_id=(SELECT auth.uid()) AND m.active
      AND (m.role='owner' OR (m.role='employee'
        AND (business_attendance.user_id=(SELECT auth.uid()) OR private.kasusaha_employee_same_identity_user(business_attendance.business_id,business_attendance.user_id))
        AND private.kasusaha_employee_device_is_paid(business_attendance.business_id)))
  )
)
WITH CHECK (
  private.kasusaha_business_license_is_verified(business_id)
  AND private.kasusaha_business_has_feature(business_id,'attendance')
  AND (
    (
      EXISTS (SELECT 1 FROM public.business_members owner_member
        WHERE owner_member.business_id=business_attendance.business_id AND owner_member.user_id=(SELECT auth.uid()) AND owner_member.active AND owner_member.role='owner')
      AND EXISTS (SELECT 1 FROM public.business_members target_member
        WHERE target_member.business_id=business_attendance.business_id AND target_member.user_id=business_attendance.user_id AND target_member.active)
    )
    OR
    (
      EXISTS (SELECT 1 FROM public.business_members employee_member
        WHERE employee_member.business_id=business_attendance.business_id AND employee_member.user_id=(SELECT auth.uid()) AND employee_member.active AND employee_member.role='employee')
      AND (user_id=(SELECT auth.uid()) OR private.kasusaha_employee_same_identity_user(business_id,user_id))
      AND private.kasusaha_employee_device_is_paid(business_id)
    )
  )
);
