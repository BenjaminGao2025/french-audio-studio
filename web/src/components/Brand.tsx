import "../../../static/brand.css";

const symbol = new URL("../../../static/brand-symbol.svg", import.meta.url).href;

/** One logo for login, desktop navigation and the mobile header. */
export function Brand() {
  return (
    <span className="brand-logo" role="img" aria-label="1000H French">
      <img className="brand-symbol" src={symbol} width={38} height={38} alt="" />
      <span className="brand-wordmark" aria-hidden>
        <span className="brand-wordmark-main">1000<span>H</span></span>
        <span className="brand-wordmark-detail">FRENCH</span>
      </span>
    </span>
  );
}
