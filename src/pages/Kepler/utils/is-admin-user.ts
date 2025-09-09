const checkAdminUser = (): boolean => {
  const queryString = window.location.search;
  const params = new URLSearchParams(queryString);
  const adminUserParameter = params.get("user");
  return adminUserParameter === "admin";
};

export default checkAdminUser;
