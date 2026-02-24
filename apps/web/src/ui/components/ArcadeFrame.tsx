import React from 'react';

export function ArcadeFrame(props: {
  headerLeft?: React.ReactNode;
  headerCenter?: React.ReactNode;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="page">
      <div className="cabinet">
        <header className="cabinetHeader">
          <div className="cabinetHeaderZone cabinetHeaderLeft">{props.headerLeft}</div>
          <div className="cabinetHeaderZone cabinetHeaderCenter">{props.headerCenter}</div>
          <div className="cabinetHeaderZone cabinetHeaderRight">{props.headerRight}</div>
        </header>

        <div className="cabinetBody">
          <main className="cabinetScreen">{props.children}</main>
        </div>
      </div>

      <footer className="cabinetFooter">
        <div className="cabinetFooterInner">
          <span>Orchard testnet</span>
          <span className="dot" />
          <span>Cyprus-1 default</span>
        </div>
      </footer>
    </div>
  );
}
