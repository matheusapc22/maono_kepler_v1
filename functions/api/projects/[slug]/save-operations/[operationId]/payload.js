import {handleProjectSaveOperation} from "../../../../../_lib/project-save-operation-http.js";
export const onRequest = (context) => handleProjectSaveOperation(context,"payload");
