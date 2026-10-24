import assert from 'node:assert/strict';

// Reverse only the separately approved notice integration. Historical controller,
// permission and navigation hashes stay unchanged; no block or regex exclusions.
const edits={
 'src/pages/ProjectsSidebar.tsx':[
  ['import NoticeBoard from "../components/notices/NoticeBoard";\n',''],
  ['            <div className="maono-profile-notices">\n              <div className="mm-sidebar-avatar" aria-hidden="true">{getInitials(user?.name || user?.email)}</div>\n              <NoticeBoard userId={user?.id} organizationId={activeOrganization?.id} suspended={switchingOrganization}/>\n','            <div className="mm-sidebar-avatar" aria-hidden="true">\n              {getInitials(user?.name || user?.email)}\n'],
  ['        {!expanded && <NoticeBoard userId={user?.id} organizationId={activeOrganization?.id} suspended={switchingOrganization}/>}\n',''],
 ],
 'src/auth/session.tsx':[
  ['import {publishNoticeSession, resetNoticeSession} from "../components/notices/notice-events";\n',''],
  ['  publishNoticeSession(session.authenticated ? session.user?.id : null, session.activeOrganization?.id);\n',''],
  ['      setSwitchingOrganization(true);\n      resetNoticeSession();\n','      setSwitchingOrganization(true);\n'],
  ['    ) => {\n      resetNoticeSession();\n      const response = await fetchAuthLoginWithDeadline({','    ) => {\n      const response = await fetchAuthLoginWithDeadline({'],
  ['  const logout = useCallback(async () => {\n    resetNoticeSession();\n','  const logout = useCallback(async () => {\n'],
 ],
 'src/pages/Projects/components/TicketsSection.tsx':[
  ['<TicketNotifications key={`notifications:${organizationId}:${user?.id}`} organizationId={organizationId} userId={user?.id} operator=','<TicketNotifications key={`notifications:${organizationId}:${user?.id}`} organizationId={organizationId} operator='],
 ],
};
export function restoreApprovedNoticeIntegration(path,source){
 if(!edits[path])return source;
 source=source.replace(/\r\n/g,'\n');
 for(const [after,before]of edits[path]){
  assert.equal(source.split(after).length-1,1,`exact approved notice integration: ${path}`);
  source=source.replace(after,before);
 }
 return source;
}
