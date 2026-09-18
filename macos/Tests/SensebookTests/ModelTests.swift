import XCTest
@testable import Sensebook
final class ModelTests: XCTestCase {
    func testEndpointValidation() throws {
        XCTAssertEqual(try Network.baseURL("https://api.deepseek.com/v1").appendingPathComponent("chat/completions").absoluteString,"https://api.deepseek.com/v1/chat/completions")
        for bad in ["http://example.com", "https://key@example.com", "https://example.com?key=secret", "file:///tmp/file"] { XCTAssertThrowsError(try Network.baseURL(bad)) }
    }
    func testCompletionAndEmptyResponse() throws {
        XCTAssertEqual(try Network.parseCompletion(Data(#"{"choices":[{"message":{"content":" 在这里指让位于。 "}}]}"#.utf8)),"在这里指让位于。")
        XCTAssertThrowsError(try Network.parseCompletion(Data(#"{"choices":[{"message":{"content":null}}]}"#.utf8)))
    }
    func testContextIncludedAndMissingIsNotFabricated() {
        let messages = Network.prompt(text:"give way",context:"",mode:"sense")
        XCTAssertTrue(messages[0]["content"]!.contains("不编造"))
        XCTAssertTrue(messages[1]["content"]!.contains("give way"))
        XCTAssertTrue(Network.prompt(text:"give way",context:"Certainty gave way to curiosity.",mode:"sense")[1]["content"]!.contains("Certainty"))
    }
    func testEventProtocolRoundTrip() throws {
        let event = QueryEvent(installation_id:"installation",selected_text:"term",context:"a term",source_app:"Notes",mode:"sense")
        let data = try JSONEncoder().encode(event)
        let object = try JSONSerialization.jsonObject(with:data) as! [String:Any]
        XCTAssertEqual(object["platform"] as? String,"macos")
        XCTAssertNil(object["api_key"])
        XCTAssertEqual(try JSONDecoder().decode(QueryEvent.self,from:data).id,event.id)
    }
}

final class ModelFixture: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let status = request.value(forHTTPHeaderField:"Authorization") == "Bearer synthetic-test-key" ? 200:401
        let response = HTTPURLResponse(url:request.url!,statusCode:status,httpVersion:"HTTP/1.1",headerFields:["Content-Type":"application/json"])!
        client?.urlProtocol(self,didReceive:response,cacheStoragePolicy:.notAllowed)
        client?.urlProtocol(self,didLoad:Data(#"{"choices":[{"message":{"content":"此处表示状态的转变。"}}]}"#.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
final class NetworkTests: XCTestCase {
    func testModelRequestAndUnauthorizedResponse() async throws {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [ModelFixture.self]
        let session = URLSession(configuration:config)
        defer { session.invalidateAndCancel() }
        let value = try await Network.explain(text:"gave way",context:"Certainty gave way to curiosity.",mode:"sense",config:ModelConfig(),key:"synthetic-test-key",session:session)
        XCTAssertEqual(value,"此处表示状态的转变。")
        do { _ = try await Network.explain(text:"x",context:"",mode:"sense",config:ModelConfig(),key:"bad",session:session); XCTFail("Must reject unauthorized response") }
        catch { XCTAssertTrue(error.localizedDescription.contains("凭据")) }
    }
    func testRedirectNeverForwardsCredential() {
        let url = URL(string:"https://untrusted.example")!
        let session = URLSession(configuration:.ephemeral)
        let task = session.dataTask(with:url)
        Network.delegate.urlSession(session,task:task,willPerformHTTPRedirection:HTTPURLResponse(url:url,statusCode:302,httpVersion:nil,headerFields:nil)!,newRequest:URLRequest(url:url)) { redirected in XCTAssertNil(redirected) }
        session.invalidateAndCancel()
    }
}
