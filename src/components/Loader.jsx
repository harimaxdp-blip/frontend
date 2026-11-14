import logo from "../assets/logo1.png";
import "./Loader.css";

export default function Loader() {
  return (
    <div className="loader-screen">
      <div className="loader-content">
        <img src={logo} alt="Loading..." className="loader-logo" />
        <div className="loader-bar-container">
          <div className="loader-bar"></div>
        </div>
      </div>
    </div>
  );
}