import { connect } from "react-redux";
import type { RootState } from "../../../store";
import { selectIsMapLoading } from "../reducers/selectors";
import Spinner from "../../../components/Spinner";

const mapStateToProps = (state: RootState) => ({
  isMapLoading: selectIsMapLoading(state),
});
const dispatchToProps = (dispatch: any) => ({ dispatch });

const connectStore = connect(mapStateToProps, dispatchToProps);

const MapUrlLoader = connectStore(
  ({ isMapLoading }: { isMapLoading: boolean }) => {
    return isMapLoading ? (
      <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-2 bg-black/50">
        <Spinner className="h-10 w-10 text-white" />
        <p className="animate-pulse text-white text-center">
          Os dados estão sendo carregados... <br /> Isso pode levar alguns
          segundos — logo tudo estará pronto para visualização.
        </p>
      </div>
    ) : null;
  }
);

export default MapUrlLoader;
