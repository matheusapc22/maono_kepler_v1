const ADMIN_USER = "adminma426o123no321";

const checkAdminUser = (): boolean => {
  const queryString = window.location.search;
  const params = new URLSearchParams(queryString);
  const adminUserParameter = params.get("user");
  return adminUserParameter === ADMIN_USER;
};

export default checkAdminUser;
