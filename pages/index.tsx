import { NextPage } from "next"

const Home: NextPage = () => {
  return (
    <div style={{ padding: "20px", fontFamily: "system-ui", textAlign: "center" }}>
      <h1>Nova HR SM - API Server</h1>
      <p>Backend API is running. Use the webapp at <a href="/webapp">/webapp</a></p>
    </div>
  )
}

export default Home