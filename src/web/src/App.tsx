import { AuthenticatedTemplate, UnauthenticatedTemplate, useMsal } from "@azure/msal-react";
import { Outlet, Link, useMatch } from "react-router-dom";
import { Button, Card, Text, makeStyles, tokens } from "@fluentui/react-components";
import { buildInteractiveLoginRequest, isMobile } from "./auth";

const useStyles = makeStyles({
  app: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    backgroundColor: tokens.colorNeutralBackground3,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    backgroundColor: tokens.colorNeutralBackground1,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    position: "sticky",
    top: 0,
    zIndex: 20,
  },
  brand: {
    color: tokens.colorNeutralForeground1,
    textDecorationLine: "none",
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase400,
  },
  user: {
    display: "flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalM,
  },
  main: {
    width: "100%",
    maxWidth: "860px",
    marginLeft: "auto",
    marginRight: "auto",
    padding: tokens.spacingHorizontalL,
  },
  mainWide: {
    maxWidth: "1280px",
  },
  unauthCard: {
    padding: tokens.spacingHorizontalL,
  },
});

export default function App() {
  const styles = useStyles();
  const { instance, accounts } = useMsal();
  const account = accounts[0];
  const isSessionDetail = useMatch("/sessions/:id") !== null;

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <Link to="/sessions" className={styles.brand}>Mobile Translator</Link>
        <div className={styles.user}>
          <AuthenticatedTemplate>
            <Text>{account?.name ?? account?.username}</Text>
            <Button appearance="secondary" onClick={() =>
              isMobile ? instance.logoutRedirect() : instance.logoutPopup()
            }>Sign out</Button>
          </AuthenticatedTemplate>
          <UnauthenticatedTemplate>
            <Button appearance="primary" onClick={() =>
              isMobile
                ? instance.loginRedirect(buildInteractiveLoginRequest())
                : instance.loginPopup(buildInteractiveLoginRequest())
            }>Sign in</Button>
          </UnauthenticatedTemplate>
        </div>
      </header>
      <main className={`${styles.main} ${isSessionDetail ? styles.mainWide : ""}`}>
        <AuthenticatedTemplate>
          <Outlet />
        </AuthenticatedTemplate>
        <UnauthenticatedTemplate>
          <Card className={styles.unauthCard}>
            <Text>サインインしてください。</Text>
          </Card>
        </UnauthenticatedTemplate>
      </main>
    </div>
  );
}
