import { Link, Stack } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { theme } from "@/src/theme";

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "Oops!" }} />
      <View style={styles.container}>
        <Text style={styles.title}>This screen does not exist.</Text>

        <Link href="/" style={styles.link}>
          <Text style={styles.linkText}>Go to home screen!</Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.background,
    padding: 20
  },
  title: {
    color: theme.colors.text,
    fontSize: 20,
    fontWeight: "bold"
  },
  link: {
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.accentBorder,
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 15,
    paddingHorizontal: 16,
    paddingVertical: 12
  },
  linkText: {
    color: theme.colors.accent,
    fontSize: 14,
    fontWeight: "700"
  }
});
