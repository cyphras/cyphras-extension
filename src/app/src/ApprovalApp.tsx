import { Routes, Route } from 'react-router-dom'
import GrantAccess from '@/pages/approval/GrantAccess'
import SignTransaction from '@/pages/approval/SignTransaction'
import SignMessage from '@/pages/approval/SignMessage'
import AddAsset from '@/pages/approval/AddAsset'
import RemoveAsset from '@/pages/approval/RemoveAsset'
import AddToken from '@/pages/approval/AddToken'
import SignAuthEntry from '@/pages/approval/SignAuthEntry'

export default function ApprovalApp() {
  return (
    <Routes>
      <Route path="/grant-access" element={<GrantAccess />} />
      <Route path="/sign-transaction" element={<SignTransaction />} />
      <Route path="/sign-message" element={<SignMessage />} />
      <Route path="/add-asset" element={<AddAsset />} />
      <Route path="/remove-asset" element={<RemoveAsset />} />
      <Route path="/add-token" element={<AddToken />} />
      <Route path="/sign-auth-entry" element={<SignAuthEntry />} />
    </Routes>
  )
}
